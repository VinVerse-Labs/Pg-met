import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, TenantFoodSubscription } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { SubscriptionsService as SaasSubscriptionsService } from '../../subscriptions/subscriptions.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  addDaysUtc,
  addOneCalendarMonthUtc,
} from '../../subscriptions/subscription-period.util';
import { FoodConfigurationService } from './food-configuration.service';
import { FoodEntitlementService } from './food-entitlement.service';
import { FoodBillingService } from './food-billing.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { DomainEventBusService } from '../../../common/events/domain-event-bus.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { CreateFoodSubscriptionDto } from '../dto/create-food-subscription.dto';
import { FoodSubscriptionResponseDto } from '../dto/food-subscription-response.dto';

type Tx = Prisma.TransactionClient;

// The optional-paid-subscription half of the food domain (spec's Model
// B/C). Deliberately never creates one of these rows for Model A
// (meals-included-in-rent) - see FoodEntitlementService for how the two
// facts combine.
@Injectable()
export class FoodSubscriptionsService {
  private readonly logger = new Logger(FoodSubscriptionsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly foodConfiguration: FoodConfigurationService,
    private readonly entitlement: FoodEntitlementService,
    private readonly saasSubscriptions: SaasSubscriptionsService,
    private readonly billing: FoodBillingService,
    private readonly auditLog: AuditLogService,
    private readonly eventBus: DomainEventBusService,
  ) {}

  // Subscribing is the one action a tenant performs for themselves - the
  // caller's own current residency is always the target, never a
  // client-supplied residencyId/tenantId (spec section 21).
  async subscribe(
    user: AuthenticatedUser,
    dto: CreateFoodSubscriptionDto,
  ): Promise<FoodSubscriptionResponseDto> {
    const context = await this.entitlement.getCallerResidencyContext(user);

    if (user.platformRole !== 'SUPER_ADMIN') {
      const blocked = await this.saasSubscriptions.isOrganizationWriteBlocked(
        context.organizationId,
      );
      if (blocked) {
        throw new AppException(
          ErrorCode.SUBSCRIPTION_SUSPENDED,
          'This organization’s subscription is suspended. Ask the PG owner to restore access.',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    const config = await this.foodConfiguration.getOrCreate(
      context.organizationId,
      context.property.id,
    );
    if (!config.enabled || !config.optionalSubscriptionEnabled) {
      throw new AppException(
        ErrorCode.FOOD_NOT_ENABLED,
        'Optional food subscriptions are not enabled at this property.',
        HttpStatus.CONFLICT,
      );
    }

    const plan = await this.prisma.foodPlan.findFirst({
      where: { id: dto.foodPlanId, propertyId: context.property.id },
    });
    if (!plan) {
      throw new AppException(
        ErrorCode.FOOD_PLAN_NOT_FOUND,
        'Food plan not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (plan.status !== 'ACTIVE') {
      throw new AppException(
        ErrorCode.FOOD_PLAN_INACTIVE,
        'Only an ACTIVE food plan can be newly subscribed to.',
        HttpStatus.CONFLICT,
      );
    }

    const existingActive = await this.prisma.tenantFoodSubscription.findFirst({
      where: { residencyId: context.residency.id, status: 'ACTIVE' },
    });
    if (existingActive) {
      throw new AppException(
        ErrorCode.FOOD_SUBSCRIPTION_ALREADY_ACTIVE,
        'This residency already has an active food subscription.',
        HttpStatus.CONFLICT,
      );
    }

    const now = new Date();
    let subscription: TenantFoodSubscription;
    try {
      subscription = await this.prisma.tenantFoodSubscription.create({
        data: {
          organizationId: context.organizationId,
          propertyId: context.property.id,
          tenantId: context.tenant.id,
          residencyId: context.residency.id,
          foodPlanId: plan.id,
          startDate: now,
          priceSnapshot: plan.price,
          currency: plan.currency,
          mealTypesSnapshot: plan.mealTypes,
        },
      });
    } catch (error) {
      // The database-level guarantee (food_subscriptions_active_residency_unique)
      // behind the pre-check above - closes the same race two concurrent
      // "subscribe" requests for the same residency could otherwise win
      // (spec section 60).
      if (
        this.isUniqueViolation(error, [
          'food_subscriptions_active_residency_unique',
        ])
      ) {
        throw new AppException(
          ErrorCode.FOOD_SUBSCRIPTION_ALREADY_ACTIVE,
          'This residency already has an active food subscription.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    // Immediately bill the first period (spec section 65: "Tenant
    // subscribes. Verify FoodSubscription = ACTIVE, FoodInvoice =
    // ISSUED") - never deferred to a later lazy read for the very first
    // invoice.
    const periodEnd = addDaysUtc(addOneCalendarMonthUtc(now), -1);
    await this.billing.generateInvoiceForPeriod(subscription, now, periodEnd);

    this.logger.log(
      `FOOD_SUBSCRIPTION_CREATED subscription=${subscription.id} residency=${context.residency.id} plan=${plan.id} by=${user.id}`,
    );
    await this.auditLog.record({
      actorUserId: user.id,
      action: 'FOOD_SUBSCRIPTION_CREATED',
      entityType: 'TenantFoodSubscription',
      entityId: subscription.id,
      organizationId: context.organizationId,
      metadata: {
        propertyId: context.property.id,
        residencyId: context.residency.id,
        foodPlanId: plan.id,
      },
    });
    await this.eventBus.emit(NotificationType.FOOD_SUBSCRIPTION_CREATED, {
      subscriptionId: subscription.id,
    });
    return FoodSubscriptionResponseDto.fromEntity(subscription);
  }

  async findOne(
    user: AuthenticatedUser,
    subscriptionId: string,
  ): Promise<FoodSubscriptionResponseDto> {
    const subscription = await this.getAccessibleSubscriptionOrThrow(
      user,
      subscriptionId,
    );
    return FoodSubscriptionResponseDto.fromEntity(subscription);
  }

  async findMyActive(
    user: AuthenticatedUser,
  ): Promise<FoodSubscriptionResponseDto | null> {
    const context = await this.entitlement.getCallerResidencyContext(user);
    const subscription = await this.prisma.tenantFoodSubscription.findFirst({
      where: { residencyId: context.residency.id, status: 'ACTIVE' },
    });
    return subscription
      ? FoodSubscriptionResponseDto.fromEntity(subscription)
      : null;
  }

  // A narrow read used only by MyFoodService's composed dashboard payload
  // - never exposed as its own endpoint.
  async findActiveIdForResidency(residencyId: string): Promise<string | null> {
    const subscription = await this.prisma.tenantFoodSubscription.findFirst({
      where: { residencyId, status: 'ACTIVE' },
      select: { id: true },
    });
    return subscription?.id ?? null;
  }

  // Broader than findActiveIdForResidency - ACTIVE or PAUSED, so
  // MyFoodController's /me/food/subscription/resume can find a currently
  // PAUSED subscription to act on, not only an ACTIVE one.
  async findNonTerminalIdForResidency(
    residencyId: string,
  ): Promise<string | null> {
    const subscription = await this.prisma.tenantFoodSubscription.findFirst({
      where: { residencyId, status: { in: ['ACTIVE', 'PAUSED'] } },
      select: { id: true },
    });
    return subscription?.id ?? null;
  }

  async findForProperty(
    user: AuthenticatedUser,
    propertyId: string,
  ): Promise<FoodSubscriptionResponseDto[]> {
    await this.assertOrgAccess(user, propertyId);
    const subscriptions = await this.prisma.tenantFoodSubscription.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'desc' },
    });
    return subscriptions.map(FoodSubscriptionResponseDto.fromEntity);
  }

  async pause(
    user: AuthenticatedUser,
    subscriptionId: string,
  ): Promise<FoodSubscriptionResponseDto> {
    const subscription = await this.getAccessibleSubscriptionOrThrow(
      user,
      subscriptionId,
    );
    return this.transition(user, subscription, 'ACTIVE', 'PAUSED');
  }

  async resume(
    user: AuthenticatedUser,
    subscriptionId: string,
  ): Promise<FoodSubscriptionResponseDto> {
    const subscription = await this.getAccessibleSubscriptionOrThrow(
      user,
      subscriptionId,
    );
    return this.transition(user, subscription, 'PAUSED', 'ACTIVE');
  }

  async cancel(
    user: AuthenticatedUser,
    subscriptionId: string,
  ): Promise<FoodSubscriptionResponseDto> {
    const subscription = await this.getAccessibleSubscriptionOrThrow(
      user,
      subscriptionId,
    );
    if (!['ACTIVE', 'PAUSED'].includes(subscription.status)) {
      throw this.invalidState(subscription.status, 'CANCELLED');
    }
    const result = await this.prisma.tenantFoodSubscription.updateMany({
      where: { id: subscription.id, status: { in: ['ACTIVE', 'PAUSED'] } },
      data: { status: 'CANCELLED', endDate: new Date() },
    });
    if (result.count === 0) {
      throw this.invalidState(subscription.status, 'CANCELLED');
    }
    this.logger.log(
      `FOOD_SUBSCRIPTION_CANCELLED subscription=${subscription.id} by=${user.id}`,
    );
    await this.auditLog.record({
      actorUserId: user.id,
      action: 'FOOD_SUBSCRIPTION_CANCELLED',
      entityType: 'TenantFoodSubscription',
      entityId: subscription.id,
      organizationId: subscription.organizationId,
      metadata: {
        propertyId: subscription.propertyId,
        residencyId: subscription.residencyId,
      },
    });
    await this.eventBus.emit(NotificationType.FOOD_SUBSCRIPTION_CANCELLED, {
      subscriptionId: subscription.id,
    });
    const updated = await this.prisma.tenantFoodSubscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return FoodSubscriptionResponseDto.fromEntity(updated);
  }

  // Called from ResidenciesService.checkOut, inside its own checkout
  // transaction (spec section 49/78: an active food subscription must not
  // outlive the residency it belongs to, but historical invoices/payments
  // remain). A no-op when there is nothing ACTIVE/PAUSED to end - checkout
  // must never fail just because food was never subscribed to.
  async cancelForCheckout(tx: Tx, residencyId: string): Promise<void> {
    await tx.tenantFoodSubscription.updateMany({
      where: { residencyId, status: { in: ['ACTIVE', 'PAUSED'] } },
      data: { status: 'EXPIRED', endDate: new Date() },
    });
  }

  private async transition(
    user: AuthenticatedUser,
    subscription: TenantFoodSubscription,
    fromStatus: 'ACTIVE' | 'PAUSED',
    toStatus: 'ACTIVE' | 'PAUSED',
  ): Promise<FoodSubscriptionResponseDto> {
    const result = await this.prisma.tenantFoodSubscription.updateMany({
      where: { id: subscription.id, status: fromStatus },
      data: { status: toStatus },
    });
    if (result.count === 0) {
      throw this.invalidState(subscription.status, toStatus);
    }
    this.logger.log(
      `FOOD_SUBSCRIPTION_${toStatus} subscription=${subscription.id} by=${user.id}`,
    );
    await this.auditLog.record({
      actorUserId: user.id,
      action:
        toStatus === 'PAUSED'
          ? 'FOOD_SUBSCRIPTION_PAUSED'
          : 'FOOD_SUBSCRIPTION_RESUMED',
      entityType: 'TenantFoodSubscription',
      entityId: subscription.id,
      organizationId: subscription.organizationId,
      metadata: {
        propertyId: subscription.propertyId,
        residencyId: subscription.residencyId,
      },
    });
    await this.eventBus.emit(
      toStatus === 'PAUSED'
        ? NotificationType.FOOD_SUBSCRIPTION_PAUSED
        : NotificationType.FOOD_SUBSCRIPTION_RESUMED,
      { subscriptionId: subscription.id },
    );
    const updated = await this.prisma.tenantFoodSubscription.findUniqueOrThrow({
      where: { id: subscription.id },
    });
    return FoodSubscriptionResponseDto.fromEntity(updated);
  }

  // BOLA-safe: the reporting tenant themselves, or any active member of
  // the owning organization - the same two-legitimate-viewer-types shape
  // Phase 9's ComplaintsService already established.
  private async getAccessibleSubscriptionOrThrow(
    user: AuthenticatedUser,
    subscriptionId: string,
  ): Promise<TenantFoodSubscription> {
    const subscription = await this.prisma.tenantFoodSubscription.findFirst({
      where: { id: subscriptionId },
      include: { tenant: { select: { userId: true } } },
    });
    if (!subscription) {
      throw this.notFound();
    }
    if (user.platformRole === 'SUPER_ADMIN') {
      return subscription;
    }
    if (subscription.tenant.userId === user.id) {
      return subscription;
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      subscription.organizationId,
    );
    if (membership) {
      return subscription;
    }
    throw this.notFound();
  }

  private async assertOrgAccess(
    user: AuthenticatedUser,
    propertyId: string,
  ): Promise<void> {
    if (user.platformRole === 'SUPER_ADMIN') {
      return;
    }
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
    });
    if (!property) {
      throw this.notFound();
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      property.organizationId,
    );
    if (!membership) {
      throw this.notFound();
    }
  }

  private invalidState(from: string, to: string): AppException {
    return new AppException(
      ErrorCode.INVALID_FOOD_SUBSCRIPTION_STATE,
      `Cannot transition a food subscription from ${from} to ${to}.`,
      HttpStatus.CONFLICT,
    );
  }

  private notFound(): AppException {
    return new AppException(
      ErrorCode.FOOD_SUBSCRIPTION_NOT_FOUND,
      'Food subscription not found.',
      HttpStatus.NOT_FOUND,
    );
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
