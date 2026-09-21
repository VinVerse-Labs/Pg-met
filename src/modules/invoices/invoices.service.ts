import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Invoice, InvoiceItem, MembershipRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { PropertiesService } from '../properties/properties.service';
import { ResidenciesService } from '../residencies/residencies.service';
import { DomainEventBusService } from '../../common/events/domain-event-bus.service';
import { NotificationType } from '../notifications/enums/notification-type.enum';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoiceResponseDto } from './dto/invoice-response.dto';
import {
  computeDueDate,
  computeMonthlyBillingPeriod,
} from './billing-period.util';
import { calculateProratedAmount, inclusiveDayCount } from './proration.util';

const CREATE_UPDATE_ROLES: MembershipRole[] = ['OWNER', 'MANAGER'];

type InvoiceWithItems = Invoice & { items: InvoiceItem[] };
type InvoiceWithItemsAndOrg = InvoiceWithItems & { organizationId: string };

const MONTH_LABELS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

@Injectable()
export class InvoicesService {
  private readonly logger = new Logger(InvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly properties: PropertiesService,
    private readonly residencies: ResidenciesService,
    private readonly eventBus: DomainEventBusService,
  ) {}

  // The one and only invoice creation path (spec section 28) - a
  // controller never builds an Invoice/InvoiceItem itself. Every
  // financial field here is server-calculated; the client names only
  // *which* residency and *which* calendar month (spec section 35).
  async generateForResidency(
    user: AuthenticatedUser,
    residencyId: string,
    dto: GenerateInvoiceDto,
  ): Promise<InvoiceResponseDto> {
    const residency = await this.residencies.getAccessibleResidencyOrThrow(
      user,
      residencyId,
    );
    await this.assertRole(user, residency.organizationId, CREATE_UPDATE_ROLES);

    const { periodStart, periodEnd } = computeMonthlyBillingPeriod(
      dto.year,
      dto.month,
    );

    if (periodEnd < residency.startDate) {
      throw new AppException(
        ErrorCode.INVALID_BILLING_PERIOD,
        'This billing period is entirely before the residency started.',
        HttpStatus.CONFLICT,
      );
    }
    if (residency.actualEndDate && periodStart > residency.actualEndDate) {
      throw new AppException(
        ErrorCode.INVALID_BILLING_PERIOD,
        'This billing period is entirely after the residency ended.',
        HttpStatus.CONFLICT,
      );
    }

    const occupiedStart =
      periodStart > residency.startDate ? periodStart : residency.startDate;
    const residencyEndBound = residency.actualEndDate ?? periodEnd;
    const occupiedEnd =
      residencyEndBound < periodEnd ? residencyEndBound : periodEnd;

    // The rent plan only needs to cover the *occupied* window, not the
    // full nominal calendar period - a residency (and its rent plan) can
    // legitimately start or end mid-period. Requiring coverage of the
    // full [periodStart, periodEnd] here would wrongly reject the
    // ordinary "resident started mid-month" case.
    const rentPlan = await this.findCoveringRentPlan(
      residencyId,
      occupiedStart,
      occupiedEnd,
    );

    const subtotal = calculateProratedAmount({
      monthlyAmount: rentPlan.amount,
      periodStart,
      periodEnd,
      occupiedStart,
      occupiedEnd,
    });
    if (subtotal.lessThanOrEqualTo(0)) {
      throw new AppException(
        ErrorCode.INVALID_BILLING_PERIOD,
        'This residency has no occupied days within the billing period.',
        HttpStatus.CONFLICT,
      );
    }

    // Phase 5 has no discount/tax engine - both are always-zero snapshot
    // fields, present so a future feature only ever needs to populate
    // them, never add a column (spec sections 32-33).
    const discount = new Prisma.Decimal(0);
    const tax = new Prisma.Decimal(0);
    const total = subtotal.minus(discount).plus(tax);
    const dueDate = computeDueDate(dto.year, dto.month, rentPlan.dueDay);
    const monthLabel = `${MONTH_LABELS[dto.month - 1]} ${dto.year}`;
    const isFullPeriod =
      occupiedStart.getTime() === periodStart.getTime() &&
      occupiedEnd.getTime() === periodEnd.getTime();
    const description = isFullPeriod
      ? `Rent for ${monthLabel}`
      : `Rent for ${monthLabel} (prorated, ${inclusiveDayCount(occupiedStart, occupiedEnd)}/${inclusiveDayCount(periodStart, periodEnd)} days)`;

    // Application-level pre-check for a fast, friendly error. The unique
    // constraint (invoices_residency_billing_period_unique) is what
    // actually guarantees this under concurrent generation for the same
    // residency+period - see the catch block below (spec sections 13/29).
    const existing = await this.prisma.invoice.findFirst({
      where: {
        residencyId,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
      },
    });
    if (existing) {
      throw this.duplicateBillingPeriod();
    }

    try {
      const invoice = await this.prisma.$transaction(async (tx) => {
        const invoiceNumber = await this.generateInvoiceNumber(tx);
        return tx.invoice.create({
          data: {
            residencyId,
            rentPlanId: rentPlan.id,
            invoiceNumber,
            billingPeriodStart: periodStart,
            billingPeriodEnd: periodEnd,
            dueDate,
            subtotal,
            discount,
            tax,
            total,
            items: {
              create: [
                {
                  description,
                  itemType: 'RENT',
                  quantity: 1,
                  unitAmount: subtotal,
                  amount: subtotal,
                },
              ],
            },
          },
          include: { items: true },
        });
      });

      this.logger.log(
        `INVOICE_GENERATED invoice=${invoice.id} number=${invoice.invoiceNumber} residency=${residencyId} by=${user.id}`,
      );
      return InvoiceResponseDto.fromEntity(invoice);
    } catch (error) {
      // Two concurrent generation requests for the same residency+period
      // can both pass the pre-check above and both reach this insert -
      // the unique constraint lets only one succeed; the loser's INSERT
      // raises P2002 here, translated into the same safe conflict a
      // sequential duplicate request would see (spec section 40).
      if (
        this.isUniqueViolation(error, [
          'invoices_residency_billing_period_unique',
          'residencyId',
          'billingPeriodStart',
          'billingPeriodEnd',
        ])
      ) {
        throw this.duplicateBillingPeriod();
      }
      throw error;
    }
  }

  async findAccessibleForProperty(
    user: AuthenticatedUser,
    propertyId: string,
  ): Promise<InvoiceResponseDto[]> {
    await this.properties.getAccessiblePropertyOrThrow(user, propertyId);
    const invoices = await this.prisma.invoice.findMany({
      where: { residency: { propertyId } },
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    const evaluated = await Promise.all(
      invoices.map((inv) => this.evaluateOverdue(inv)),
    );
    return evaluated.map(InvoiceResponseDto.fromEntity);
  }

  async findOne(
    user: AuthenticatedUser,
    invoiceId: string,
  ): Promise<InvoiceResponseDto> {
    const invoice = await this.getAccessibleInvoiceOrThrow(user, invoiceId);
    const evaluated = await this.evaluateOverdue(invoice);
    return InvoiceResponseDto.fromEntity(evaluated);
  }

  async update(
    user: AuthenticatedUser,
    invoiceId: string,
    dto: UpdateInvoiceDto,
  ): Promise<InvoiceResponseDto> {
    const invoice = await this.getAccessibleInvoiceOrThrow(user, invoiceId);
    await this.assertRole(user, invoice.organizationId, CREATE_UPDATE_ROLES);

    if (invoice.status !== 'DRAFT') {
      throw new AppException(
        ErrorCode.INVALID_INVOICE_STATE,
        'Only a DRAFT invoice can be updated.',
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { dueDate: new Date(dto.dueDate) },
      include: { items: true },
    });
    return InvoiceResponseDto.fromEntity(updated);
  }

  // DRAFT -> ISSUED. Sets issueDate. Never re-issuable once past DRAFT.
  async issue(
    user: AuthenticatedUser,
    invoiceId: string,
  ): Promise<InvoiceResponseDto> {
    const invoice = await this.getAccessibleInvoiceOrThrow(user, invoiceId);
    await this.assertRole(user, invoice.organizationId, CREATE_UPDATE_ROLES);

    if (invoice.status === 'VOID') {
      throw new AppException(
        ErrorCode.INVOICE_ALREADY_VOID,
        'A voided invoice cannot be issued.',
        HttpStatus.CONFLICT,
      );
    }
    if (invoice.status !== 'DRAFT') {
      throw new AppException(
        ErrorCode.INVOICE_ALREADY_ISSUED,
        'This invoice has already been issued.',
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'ISSUED', issueDate: new Date() },
      include: { items: true },
    });
    this.logger.log(`INVOICE_ISSUED invoice=${invoiceId} by=${user.id}`);
    await this.eventBus.emit(NotificationType.RENT_INVOICE_ISSUED, {
      invoiceId,
    });
    return InvoiceResponseDto.fromEntity(updated);
  }

  // (DRAFT|ISSUED|OVERDUE) -> VOID. Terminal - spec sections 17/23
  // deliberately do not support re-issuing a voided invoice; a correction
  // is a brand new invoice, never a resurrected one.
  async voidInvoice(
    user: AuthenticatedUser,
    invoiceId: string,
  ): Promise<InvoiceResponseDto> {
    const invoice = await this.getAccessibleInvoiceOrThrow(user, invoiceId);
    await this.assertRole(user, invoice.organizationId, CREATE_UPDATE_ROLES);

    if (invoice.status === 'VOID') {
      throw new AppException(
        ErrorCode.INVOICE_ALREADY_VOID,
        'This invoice has already been voided.',
        HttpStatus.CONFLICT,
      );
    }

    const updated = await this.prisma.invoice.update({
      where: { id: invoiceId },
      data: { status: 'VOID' },
      include: { items: true },
    });
    this.logger.log(`INVOICE_VOIDED invoice=${invoiceId} by=${user.id}`);
    return InvoiceResponseDto.fromEntity(updated);
  }

  // Determines the single RentPlan that fully covers [periodStart,
  // periodEnd]. If a plan only partially overlaps (rent changed mid-period)
  // this deliberately refuses rather than silently billing the wrong rate
  // for part of the period - splitting one invoice across two rates is a
  // documented Phase 5 limitation (see README), not a silent bug.
  private async findCoveringRentPlan(
    residencyId: string,
    periodStart: Date,
    periodEnd: Date,
  ) {
    const covering = await this.prisma.rentPlan.findFirst({
      where: {
        residencyId,
        effectiveFrom: { lte: periodStart },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: periodEnd } }],
      },
      orderBy: { effectiveFrom: 'desc' },
    });
    if (covering) {
      return covering;
    }

    const partialOverlap = await this.prisma.rentPlan.findFirst({
      where: {
        residencyId,
        effectiveFrom: { lte: periodEnd },
        OR: [{ effectiveTo: null }, { effectiveTo: { gt: periodStart } }],
      },
    });
    if (partialOverlap) {
      throw new AppException(
        ErrorCode.INVALID_BILLING_PERIOD,
        'The rent plan changed during this billing period; billing a period that spans two rent plans is not supported yet.',
        HttpStatus.CONFLICT,
      );
    }

    throw new AppException(
      ErrorCode.RENT_PLAN_NOT_FOUND,
      'No rent plan covers this billing period.',
      HttpStatus.NOT_FOUND,
    );
  }

  // Concurrency-safe invoice numbering (spec section 12): `nextval()` on a
  // Postgres sequence is atomic regardless of how many transactions call
  // it simultaneously - never `COUNT(*) + 1`, which races. A rolled-back
  // transaction can "waste" a sequence value (a gap), which is acceptable:
  // the only real requirement is uniqueness, not gaplessness. The year
  // prefix is a label from generation time, not a per-year reset boundary
  // - the sequence itself is global (see migration SQL / README).
  private async generateInvoiceNumber(
    tx: Prisma.TransactionClient,
  ): Promise<string> {
    const rows = await tx.$queryRaw<{ nextval: bigint | string }[]>`
      SELECT nextval('invoice_number_seq') AS nextval
    `;
    const sequenceValue = String(rows[0].nextval);
    const year = new Date().getUTCFullYear();
    return `INV-${year}-${sequenceValue.padStart(6, '0')}`;
  }

  // Lazy OVERDUE evaluation (spec section 20): there is no cron/job
  // infrastructure in this project, so nothing proactively sweeps for
  // overdue invoices. Every read path (findOne, findAccessibleForProperty)
  // opportunistically persists ISSUED -> OVERDUE when the due date has
  // passed, so the stored `status` column stays queryable
  // (`WHERE status = 'OVERDUE'`) without needing a scheduled job - a real
  // Phase 6 job could call this same transition proactively instead.
  private async evaluateOverdue(
    invoice: InvoiceWithItems,
  ): Promise<InvoiceWithItems> {
    if (invoice.status === 'ISSUED' && invoice.dueDate.getTime() < Date.now()) {
      const updated = await this.prisma.invoice.update({
        where: { id: invoice.id },
        data: { status: 'OVERDUE' },
        include: { items: true },
      });
      // This lazy ISSUED -> OVERDUE transition only ever happens once per
      // invoice (subsequent reads see status already OVERDUE and skip
      // this branch entirely), so the event fires exactly once - never on
      // every incidental read.
      await this.eventBus.emit(NotificationType.RENT_INVOICE_OVERDUE, {
        invoiceId: invoice.id,
      });
      return updated;
    }
    return invoice;
  }

  // BOLA/IDOR defense, joining two levels up (Invoice -> Residency ->
  // Property) to reach organizationId - the same single-query pattern as
  // every prior phase.
  private async getAccessibleInvoiceOrThrow(
    user: AuthenticatedUser,
    invoiceId: string,
  ): Promise<InvoiceWithItemsAndOrg> {
    const isSuperAdmin = user.platformRole === 'SUPER_ADMIN';
    const accessibleOrgIds = isSuperAdmin
      ? undefined
      : await this.memberships.listActiveOrganizationIds(user.id);

    const invoice = await this.prisma.invoice.findFirst({
      where: {
        id: invoiceId,
        residency: isSuperAdmin
          ? undefined
          : { property: { organizationId: { in: accessibleOrgIds } } },
      },
      include: {
        items: true,
        residency: {
          include: { property: { select: { organizationId: true } } },
        },
      },
    });
    if (!invoice) {
      throw new AppException(
        ErrorCode.INVOICE_NOT_FOUND,
        'Invoice not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const { residency, ...fields } = invoice;
    return { ...fields, organizationId: residency.property.organizationId };
  }

  private async assertRole(
    user: AuthenticatedUser,
    organizationId: string,
    allowedRoles: MembershipRole[],
  ): Promise<void> {
    if (user.platformRole === 'SUPER_ADMIN') {
      return;
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      organizationId,
    );
    this.memberships.assertRole(user, membership, allowedRoles);
  }

  private duplicateBillingPeriod(): AppException {
    return new AppException(
      ErrorCode.DUPLICATE_BILLING_PERIOD,
      'An invoice for this residency and billing period already exists.',
      HttpStatus.CONFLICT,
    );
  }

  // Prisma's P2002 `target` is not consistently the constraint's SQL name
  // across providers/versions - against the real Postgres engine, a
  // violation of a plain (non-partial) `@@unique([...], name: "...")`
  // comes back as the array of column names it covers, not the name given
  // to it in schema.prisma (confirmed by running this exact check against
  // the live database - see the Phase 6 final report, where the same bug
  // was caught in the analogous WebhookEvent check). Matching against
  // either the declared name or its column names is robust to both
  // shapes.
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
