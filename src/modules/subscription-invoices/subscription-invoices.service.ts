import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Prisma, SaasPlan, SubscriptionInvoice } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SubscriptionInvoiceResponseDto } from './dto/subscription-invoice-response.dto';

type Tx = Prisma.TransactionClient;

@Injectable()
export class SubscriptionInvoicesService {
  private readonly logger = new Logger(SubscriptionInvoicesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
  ) {}

  // The one and only SaaS-invoice creation path - called only by
  // SubscriptionsService.evaluateLifecycle from inside an already-open
  // transaction on that subscription's row (see its docs), never invoked
  // directly by a controller: there is no "generate SaaS invoice"
  // endpoint, since these are system-generated at renewal time, not
  // owner-authored the way Phase 5's tenant rent invoices are.
  //
  // `subtotal`/`tax`/`total` snapshot the plan's *current* price at
  // generation time - a later SaasPlan.price change never alters this row
  // (same principle as Phase 5's Invoice never re-reading RentPlan).
  async generateForPeriod(
    tx: Tx,
    organizationId: string,
    subscriptionId: string,
    plan: SaasPlan,
    periodStart: Date,
    periodEnd: Date,
    dueAt: Date,
  ): Promise<SubscriptionInvoice> {
    const tax = new Prisma.Decimal(0);
    const total = plan.price.plus(tax);
    const invoiceNumber = await this.generateInvoiceNumber(tx);
    this.logger.log(
      `SUBSCRIPTION_INVOICE_GENERATED organization=${organizationId} subscription=${subscriptionId} number=${invoiceNumber}`,
    );

    return tx.subscriptionInvoice.create({
      data: {
        organizationId,
        subscriptionId,
        saasPlanId: plan.id,
        invoiceNumber,
        billingPeriodStart: periodStart,
        billingPeriodEnd: periodEnd,
        subtotal: plan.price,
        tax,
        total,
        currency: plan.currency,
        status: 'ISSUED',
        issuedAt: new Date(),
        dueAt,
      },
    });
  }

  // OWNER-only, same as every subscription-billing endpoint (spec:
  // "MANAGER and STAFF: read/write subscription billing = forbidden").
  async findForOrganization(
    user: AuthenticatedUser,
    organizationId: string,
  ): Promise<SubscriptionInvoiceResponseDto[]> {
    await this.assertOwner(user, organizationId);
    const invoices = await this.prisma.subscriptionInvoice.findMany({
      where: { organizationId },
      orderBy: { createdAt: 'desc' },
    });
    return invoices.map(SubscriptionInvoiceResponseDto.fromEntity);
  }

  async findOne(
    user: AuthenticatedUser,
    invoiceId: string,
  ): Promise<SubscriptionInvoiceResponseDto> {
    const invoice = await this.getAccessibleInvoiceOrThrow(user, invoiceId);
    return SubscriptionInvoiceResponseDto.fromEntity(invoice);
  }

  // BOLA-safe lookup, the same single-query pattern every prior phase
  // uses - never "load by id, then check ownership after". Exported for
  // SubscriptionPaymentsService to reuse (the same "reuse the layer
  // above" chain principle as every prior phase - see README).
  async getAccessibleInvoiceOrThrow(
    user: AuthenticatedUser,
    invoiceId: string,
  ): Promise<SubscriptionInvoice> {
    const isSuperAdmin = user.platformRole === 'SUPER_ADMIN';
    const accessibleOrgIds = isSuperAdmin
      ? undefined
      : await this.memberships.listActiveOrganizationIds(user.id);

    const invoice = await this.prisma.subscriptionInvoice.findFirst({
      where: {
        id: invoiceId,
        organizationId: isSuperAdmin ? undefined : { in: accessibleOrgIds },
      },
    });
    if (!invoice) {
      throw this.notFound();
    }
    if (!isSuperAdmin) {
      await this.assertOwner(user, invoice.organizationId);
    }
    return invoice;
  }

  // Concurrency-safe SaaS invoice numbering - a dedicated Postgres
  // sequence (`saas_invoice_number_seq`, created by hand in this phase's
  // migration SQL), never `COUNT(*) + 1`. Same reasoning and mechanism as
  // Phase 5's InvoicesService.generateInvoiceNumber.
  private async generateInvoiceNumber(tx: Tx): Promise<string> {
    const rows = await tx.$queryRaw<{ nextval: bigint | string }[]>`
      SELECT nextval('saas_invoice_number_seq') AS nextval
    `;
    const sequenceValue = String(rows[0].nextval);
    const year = new Date().getUTCFullYear();
    return `SAAS-${year}-${sequenceValue.padStart(6, '0')}`;
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

  private notFound(): AppException {
    return new AppException(
      ErrorCode.SUBSCRIPTION_INVOICE_NOT_FOUND,
      'Subscription invoice not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}
