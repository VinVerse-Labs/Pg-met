import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { OrganizationSubscription, Prisma, SaasPlan } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SubscriptionConfig } from '../../config/configuration';
import { SaasPlansService } from '../saas-plans/saas-plans.service';
import { SubscriptionInvoicesService } from '../subscription-invoices/subscription-invoices.service';
import { DomainEventBusService } from '../../common/events/domain-event-bus.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import {
  addDaysUtc,
  computeNextSubscriptionPeriod,
} from './subscription-period.util';
import { ChangePlanDto } from './dto/change-plan.dto';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';

type SubscriptionWithPlan = OrganizationSubscription & { saasPlan: SaasPlan };

// The owner SaaS subscription lifecycle (spec: TRIAL -> ACTIVE ->
// RENEWAL_DUE -> GRACE_PERIOD -> SUSPENDED, with a successful payment
// returning to ACTIVE from RENEWAL_DUE/GRACE_PERIOD/SUSPENDED). Every
// transition is decided here, never by a client-supplied status field
// (spec: "do not allow arbitrary status changes through a generic PATCH
// endpoint") - explicit action methods only (changePlan, cancel), plus
// lazy, idempotent lifecycle evaluation on every read - the same
// no-cron-infrastructure pattern Phase 5's InvoicesService.evaluateOverdue
// already established, extended here to also generate the next SaaS
// invoice and step through RENEWAL_DUE/GRACE_PERIOD/SUSPENDED. See
// processDueSubscriptions for the seam a future scheduled job would call
// instead of relying on incidental reads.
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);
  private readonly trialDays: number;
  private readonly gracePeriodDays: number;

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly saasPlans: SaasPlansService,
    private readonly subscriptionInvoices: SubscriptionInvoicesService,
    private readonly eventBus: DomainEventBusService,
    configService: ConfigService,
  ) {
    const config = configService.get<SubscriptionConfig>('subscription')!;
    this.trialDays = config.trialDays;
    this.gracePeriodDays = config.gracePeriodDays;
  }

  // OWNER-only (spec: subscription billing is OWNER-only, even to view).
  // Lazily provisions a TRIAL subscription on first access - there is no
  // separate "start subscription" endpoint, the same "created on first
  // legitimate need" pattern as this project's other lazily-evaluated
  // state (see evaluateLifecycle below).
  async getOrCreateForOrganization(
    user: AuthenticatedUser,
    organizationId: string,
  ): Promise<SubscriptionResponseDto> {
    await this.assertOwner(user, organizationId);
    const subscription = await this.ensureSubscriptionExists(organizationId);
    const evaluated = await this.evaluateLifecycle(subscription.id);
    return SubscriptionResponseDto.fromEntity(evaluated);
  }

  async changePlan(
    user: AuthenticatedUser,
    organizationId: string,
    dto: ChangePlanDto,
  ): Promise<SubscriptionResponseDto> {
    await this.assertOwner(user, organizationId);
    const subscription = await this.ensureSubscriptionExists(organizationId);
    if (subscription.status === 'CANCELLED') {
      throw new AppException(
        ErrorCode.INVALID_SUBSCRIPTION_STATE,
        'A cancelled subscription cannot change plans.',
        HttpStatus.CONFLICT,
      );
    }
    const newPlan = await this.saasPlans.getActiveByIdOrThrow(dto.saasPlanId);

    // Takes effect at the next billing period (spec) - never rewrites the
    // current period's already-issued invoice or the plan it snapshotted.
    const updated = await this.prisma.organizationSubscription.update({
      where: { id: subscription.id },
      data: { pendingSaasPlanId: newPlan.id },
      include: { saasPlan: true },
    });
    this.logger.log(
      `SUBSCRIPTION_PLAN_CHANGE_SCHEDULED organization=${organizationId} plan=${newPlan.id} by=${user.id}`,
    );
    const evaluated = await this.evaluateLifecycle(updated.id);
    return SubscriptionResponseDto.fromEntity(evaluated);
  }

  // "Cancel at period end" (spec), never immediate deletion of access or
  // data - evaluateLifecycle is what actually flips status to CANCELLED,
  // once currentPeriodEnd is reached, instead of generating another
  // invoice.
  async cancel(
    user: AuthenticatedUser,
    organizationId: string,
  ): Promise<SubscriptionResponseDto> {
    await this.assertOwner(user, organizationId);
    const subscription = await this.ensureSubscriptionExists(organizationId);
    if (subscription.status === 'CANCELLED') {
      throw new AppException(
        ErrorCode.INVALID_SUBSCRIPTION_STATE,
        'This subscription is already cancelled.',
        HttpStatus.CONFLICT,
      );
    }
    if (subscription.cancelledAt) {
      throw new AppException(
        ErrorCode.INVALID_SUBSCRIPTION_STATE,
        'Cancellation has already been requested for this subscription.',
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.organizationSubscription.update({
      where: { id: subscription.id },
      data: { cancelledAt: new Date() },
      include: { saasPlan: true },
    });
    this.logger.log(
      `SUBSCRIPTION_CANCEL_REQUESTED organization=${organizationId} by=${user.id}`,
    );
    const evaluated = await this.evaluateLifecycle(updated.id);
    return SubscriptionResponseDto.fromEntity(evaluated);
  }

  // Called after a SubscriptionPayment is CAPTURED
  // (SubscriptionPaymentsService.finalizeCapturedPayment) inside that same
  // locked transaction - extends the period, applies any pending plan
  // change, and returns to ACTIVE from whichever pre-payment state the
  // subscription was in (RENEWAL_DUE / GRACE_PERIOD / SUSPENDED).
  async activateFromPayment(
    tx: Prisma.TransactionClient,
    subscriptionId: string,
    paidInvoicePeriodStart: Date,
    paidInvoicePeriodEnd: Date,
  ): Promise<void> {
    const subscription = await tx.organizationSubscription.findUniqueOrThrow({
      where: { id: subscriptionId },
    });
    await tx.organizationSubscription.update({
      where: { id: subscriptionId },
      data: {
        status: 'ACTIVE',
        currentPeriodStart: paidInvoicePeriodStart,
        currentPeriodEnd: paidInvoicePeriodEnd,
        nextBillingAt: paidInvoicePeriodEnd,
        gracePeriodEndsAt: null,
        saasPlanId: subscription.pendingSaasPlanId ?? subscription.saasPlanId,
        pendingSaasPlanId: null,
      },
    });
  }

  // Idempotent, safe to call repeatedly (spec: "the operation must be
  // idempotent") - the seam a future `daily scheduled job` would call in
  // a loop over every subscription instead of relying on incidental
  // reads. Not wired to any actual scheduler in Phase 7 since this
  // project has no scheduling infrastructure (same reasoning as Phase 5's
  // lazy OVERDUE evaluation).
  async processDueSubscriptions(): Promise<number> {
    const now = new Date();
    const candidates = await this.prisma.organizationSubscription.findMany({
      where: {
        status: { in: ['TRIAL', 'ACTIVE', 'RENEWAL_DUE', 'GRACE_PERIOD'] },
        OR: [
          { nextBillingAt: { lte: now } },
          { gracePeriodEndsAt: { lte: now } },
        ],
      },
      select: { id: true },
    });
    for (const { id } of candidates) {
      await this.evaluateLifecycle(id);
    }
    return candidates.length;
  }

  // The single lifecycle state machine, run inside one locked transaction
  // per subscription so two concurrent evaluations (e.g. two simultaneous
  // reads) cannot both generate a duplicate invoice for the same period -
  // `SELECT ... FOR UPDATE` on the subscription row, the same technique
  // Phase 6's PaymentsService uses for its own aggregate invariant.
  async evaluateLifecycle(
    subscriptionId: string,
  ): Promise<SubscriptionWithPlan> {
    let transitionedTo: 'RENEWAL_DUE' | 'SUSPENDED' | null = null;
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT id FROM organization_subscriptions WHERE id = ${subscriptionId} FOR UPDATE`;
      let subscription = await tx.organizationSubscription.findUniqueOrThrow({
        where: { id: subscriptionId },
        include: { saasPlan: true },
      });
      const now = new Date();

      if (
        (subscription.status === 'TRIAL' || subscription.status === 'ACTIVE') &&
        now >= subscription.currentPeriodEnd
      ) {
        if (subscription.cancelledAt) {
          subscription = await tx.organizationSubscription.update({
            where: { id: subscription.id },
            data: { status: 'CANCELLED' },
            include: { saasPlan: true },
          });
          this.logger.log(
            `SUBSCRIPTION_CANCELLED subscription=${subscription.id}`,
          );
          return subscription;
        }

        const plan = subscription.pendingSaasPlanId
          ? await tx.saasPlan.findUniqueOrThrow({
              where: { id: subscription.pendingSaasPlanId },
            })
          : subscription.saasPlan;
        const { periodStart, periodEnd } = computeNextSubscriptionPeriod(
          subscription.currentPeriodEnd,
        );
        await this.subscriptionInvoices.generateForPeriod(
          tx,
          subscription.organizationId,
          subscription.id,
          plan,
          periodStart,
          periodEnd,
          now,
        );
        subscription = await tx.organizationSubscription.update({
          where: { id: subscription.id },
          data: { status: 'RENEWAL_DUE' },
          include: { saasPlan: true },
        });
        this.logger.log(
          `SUBSCRIPTION_RENEWAL_DUE subscription=${subscription.id} period=${periodStart.toISOString()}..${periodEnd.toISOString()}`,
        );
        transitionedTo = 'RENEWAL_DUE';
        return subscription;
      }

      if (subscription.status === 'RENEWAL_DUE') {
        subscription = await tx.organizationSubscription.update({
          where: { id: subscription.id },
          data: {
            status: 'GRACE_PERIOD',
            gracePeriodEndsAt: addDaysUtc(now, this.gracePeriodDays),
          },
          include: { saasPlan: true },
        });
        this.logger.log(
          `SUBSCRIPTION_GRACE_PERIOD_STARTED subscription=${subscription.id} endsAt=${subscription.gracePeriodEndsAt?.toISOString()}`,
        );
        return subscription;
      }

      if (
        subscription.status === 'GRACE_PERIOD' &&
        subscription.gracePeriodEndsAt &&
        now >= subscription.gracePeriodEndsAt
      ) {
        subscription = await tx.organizationSubscription.update({
          where: { id: subscription.id },
          data: { status: 'SUSPENDED' },
          include: { saasPlan: true },
        });
        this.logger.log(
          `SUBSCRIPTION_SUSPENDED subscription=${subscription.id}`,
        );
        transitionedTo = 'SUSPENDED';
        return subscription;
      }

      return subscription;
    });

    // Fired after the transaction has already committed (spec section
    // 46). `transitionedTo` is only ever set on the exact call that
    // caused the transition - every subsequent read that finds the
    // subscription already in that state takes the final `return
    // subscription` branch and never re-emits (the same "the state
    // machine's own one-way transition is the idempotency guarantee"
    // pattern Phase 5's evaluateOverdue/this phase's own menu-publish
    // notification both already rely on).
    if (transitionedTo === 'RENEWAL_DUE') {
      await this.eventBus.emit(NotificationType.SAAS_SUBSCRIPTION_RENEWAL_DUE, {
        organizationId: result.organizationId,
      });
    } else if (transitionedTo === 'SUSPENDED') {
      await this.eventBus.emit(NotificationType.SAAS_SUBSCRIPTION_SUSPENDED, {
        organizationId: result.organizationId,
      });
    }
    return result;
  }

  // The read-only half of the access policy (see SubscriptionAccessGuard's
  // doc comment for why it is not yet wired into any Phase 0-6 route).
  // Deliberately checks only *membership* (any role), not OWNER-only like
  // every billing endpoint above - suspension is meant to block a
  // MANAGER/STAFF's normal day-to-day operations too, not just the
  // OWNER's. Evaluates lifecycle first so a subscription that has just
  // crossed into SUSPENDED is reflected immediately, not on the next
  // incidental read.
  async isAccessBlocked(
    user: AuthenticatedUser,
    organizationId: string,
  ): Promise<boolean> {
    if (user.platformRole === 'SUPER_ADMIN') {
      return false;
    }
    await this.memberships.assertOrganizationAccess(user, organizationId);
    return this.isOrganizationWriteBlocked(organizationId);
  }

  // The pure, user-independent half of the policy - added for Phase 9
  // (Complaints), which surfaced a real gap `isAccessBlocked` above
  // could not fill: a *tenant* creating a complaint is not an
  // `OrganizationMembership` row at all (the same "tenant is connected
  // to an organization only through Residency.tenant.userId, not
  // membership" fact Phase 6 already had to solve for payments - see
  // README's "Phase 6" section), so `assertOrganizationAccess` would
  // wrongly reject a legitimate tenant here. Callers of this method must
  // have already established the caller's legitimate relationship to
  // `organizationId` through their own domain logic (a residency lookup
  // for a tenant, a membership check for OWNER/MANAGER/STAFF) - this
  // method only ever answers "is this organization's subscription
  // currently blocking normal writes," never "is this caller allowed to
  // know that."
  //
  // Phase 9's documented policy (spec's "RECOMMENDED SUBSCRIPTION ACCESS
  // POLICY"): TRIAL/ACTIVE/RENEWAL_DUE/GRACE_PERIOD remain fully
  // operational; SUSPENDED and CANCELLED block normal operational
  // writes. This is a superset of `isAccessBlocked`'s own SUSPENDED-only
  // check (kept unchanged above, to avoid altering Phase 7's existing
  // behavior) - CANCELLED is additionally blocking here because a
  // cancelled subscription has no recovery path back to ACTIVE at all
  // (see Phase 7's lifecycle), so there is no "let them keep working
  // while they fix billing" case to preserve for it, unlike SUSPENDED.
  async isOrganizationWriteBlocked(organizationId: string): Promise<boolean> {
    const subscription = await this.ensureSubscriptionExists(organizationId);
    const evaluated = await this.evaluateLifecycle(subscription.id);
    return evaluated.status === 'SUSPENDED' || evaluated.status === 'CANCELLED';
  }

  private async ensureSubscriptionExists(
    organizationId: string,
  ): Promise<OrganizationSubscription> {
    const existing = await this.prisma.organizationSubscription.findUnique({
      where: { organizationId },
    });
    if (existing) {
      return existing;
    }

    const defaultPlan = await this.saasPlans.getDefaultActivePlan();
    const now = new Date();
    const currentPeriodEnd = addDaysUtc(now, this.trialDays);
    try {
      const created = await this.prisma.organizationSubscription.create({
        data: {
          organizationId,
          saasPlanId: defaultPlan.id,
          status: 'TRIAL',
          startedAt: now,
          currentPeriodStart: now,
          currentPeriodEnd,
          nextBillingAt: currentPeriodEnd,
        },
      });
      this.logger.log(
        `SUBSCRIPTION_TRIAL_STARTED organization=${organizationId} plan=${defaultPlan.id} endsAt=${currentPeriodEnd.toISOString()}`,
      );
      return created;
    } catch (error) {
      // Two concurrent first-access requests for the same organization
      // can both pass the pre-check above - `organizationId` is @unique,
      // so only one INSERT wins; the loser re-reads the winner's row
      // rather than erroring, the same pre-check-then-DB-guarantee
      // pattern every prior phase uses.
      if (this.isUniqueViolation(error, ['organizationId'])) {
        return this.prisma.organizationSubscription.findUniqueOrThrow({
          where: { organizationId },
        });
      }
      throw error;
    }
  }

  private async assertOwner(
    user: AuthenticatedUser,
    organizationId: string,
  ): Promise<void> {
    if (user.platformRole === 'SUPER_ADMIN') {
      return;
    }
    const { membership } = await this.memberships.assertOrganizationAccess(
      user,
      organizationId,
    );
    this.memberships.assertRole(user, membership, ['OWNER']);
  }

  private isUniqueViolation(error: unknown, candidates: string[]): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    const target = error.meta?.target;
    if (typeof target === 'string') {
      return candidates.some((c) => target === c || target.includes(c));
    }
    if (Array.isArray(target)) {
      return candidates.some((c) => target.includes(c));
    }
    return false;
  }
}
