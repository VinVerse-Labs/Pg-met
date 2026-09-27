import { HttpStatus, Injectable } from '@nestjs/common';
import {
  Invoice,
  InvoiceItem,
  InvoiceStatus,
  Payment,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import {
  PaginatedResult,
  PaginationQueryDto,
  paginationSkipTake,
} from '../../../common/dto/pagination-query.dto';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ListMyInvoicesQueryDto } from '../dto/list-my-invoices.query.dto';
import {
  MyInvoiceDetailDto,
  MyInvoiceDto,
  MyPaymentDto,
  MyRentSummaryDto,
} from '../dto/my-invoice-response.dto';

// Same set PaymentsService accepts an order for - kept in step with
// PAYABLE_INVOICE_STATUSES there so `isPayable` never promises a payment
// the order endpoint would reject.
const PAYABLE_STATUSES: InvoiceStatus[] = [
  'ISSUED',
  'OVERDUE',
  'PARTIALLY_PAID',
];

type InvoiceRow = Invoice & { residency: { property: { name: string } } };
type PaymentRow = Payment & { invoice: { invoiceNumber: string } };

// The tenant's own rent billing, read-only. Every query is scoped to the
// caller server-side - invoices through `residency.tenant.userId`,
// payments through `payerUserId` - so an invoice/payment id belonging to
// anyone else is a plain 404, never a 403 (existence is not confirmed).
// DRAFT invoices are never shown: they have not been issued to the tenant.
@Injectable()
export class MyBillingService {
  constructor(private readonly prisma: PrismaService) {}

  private tenantInvoiceWhere(
    user: AuthenticatedUser,
  ): Prisma.InvoiceWhereInput {
    return {
      residency: { tenant: { userId: user.id } },
      status: { not: 'DRAFT' },
    };
  }

  async listInvoices(
    user: AuthenticatedUser,
    query: ListMyInvoicesQueryDto,
  ): Promise<PaginatedResult<MyInvoiceDto>> {
    const { skip, take } = paginationSkipTake(query);
    const where: Prisma.InvoiceWhereInput = {
      ...this.tenantInvoiceWhere(user),
      ...(query.status && query.status !== 'DRAFT'
        ? { status: query.status }
        : {}),
    };
    // A DRAFT filter would otherwise match nothing anyway; make it explicit.
    if (query.status === 'DRAFT') {
      return {
        items: [],
        total: 0,
        page: query.page ?? 1,
        limit: query.limit ?? 20,
      };
    }
    const [rows, total] = await Promise.all([
      this.prisma.invoice.findMany({
        where,
        include: {
          residency: { select: { property: { select: { name: true } } } },
        },
        orderBy: [{ billingPeriodStart: 'desc' }, { createdAt: 'desc' }],
        skip,
        take,
      }),
      this.prisma.invoice.count({ where }),
    ]);
    const paid = await this.allocatedTotals(rows.map((r) => r.id));
    return {
      items: rows.map((row) => this.toInvoiceDto(row, paid.get(row.id))),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  async getInvoice(
    user: AuthenticatedUser,
    invoiceId: string,
  ): Promise<MyInvoiceDetailDto> {
    const invoice = await this.prisma.invoice.findFirst({
      where: { id: invoiceId, ...this.tenantInvoiceWhere(user) },
      include: {
        items: { orderBy: { createdAt: 'asc' } },
        residency: { select: { property: { select: { name: true } } } },
        payments: {
          where: { payerUserId: user.id },
          orderBy: { createdAt: 'desc' },
          include: { invoice: { select: { invoiceNumber: true } } },
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
    const paid = await this.allocatedTotals([invoice.id]);
    const dto = Object.assign(
      new MyInvoiceDetailDto(),
      this.toInvoiceDto(invoice, paid.get(invoice.id)),
    );
    dto.items = invoice.items.map((item: InvoiceItem) => ({
      id: item.id,
      description: item.description,
      itemType: item.itemType,
      quantity: item.quantity,
      unitAmount: item.unitAmount.toFixed(2),
      amount: item.amount.toFixed(2),
    }));
    dto.payments = invoice.payments.map((p) => this.toPaymentDto(p));
    return dto;
  }

  async getRentSummary(user: AuthenticatedUser): Promise<MyRentSummaryDto> {
    const open = await this.prisma.invoice.findMany({
      where: {
        residency: { tenant: { userId: user.id } },
        status: { in: PAYABLE_STATUSES },
      },
      include: {
        residency: { select: { property: { select: { name: true } } } },
      },
      orderBy: { dueDate: 'asc' },
    });
    const paid = await this.allocatedTotals(open.map((r) => r.id));
    const invoices = open
      .map((row) => this.toInvoiceDto(row, paid.get(row.id)))
      .filter((inv) => inv.isPayable);

    const byCurrency = new Map<string, Prisma.Decimal>();
    for (const inv of invoices) {
      const current = byCurrency.get(inv.currency) ?? new Prisma.Decimal(0);
      byCurrency.set(inv.currency, current.plus(inv.balanceDue));
    }

    const summary = new MyRentSummaryDto();
    summary.outstanding = [...byCurrency.entries()].map(
      ([currency, amount]) => ({
        currency,
        amount: amount.toFixed(2),
      }),
    );
    summary.openInvoiceCount = invoices.length;
    summary.overdueInvoiceCount = invoices.filter(
      (i) => i.status === 'OVERDUE',
    ).length;
    summary.nextDue = invoices[0] ?? null;
    return summary;
  }

  async listPayments(
    user: AuthenticatedUser,
    query: PaginationQueryDto,
  ): Promise<PaginatedResult<MyPaymentDto>> {
    const { skip, take } = paginationSkipTake(query);
    const where: Prisma.PaymentWhereInput = { payerUserId: user.id };
    const [rows, total] = await Promise.all([
      this.prisma.payment.findMany({
        where,
        include: { invoice: { select: { invoiceNumber: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.payment.count({ where }),
    ]);
    return {
      items: rows.map((row) => this.toPaymentDto(row)),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  // Sum of PaymentAllocation per invoice - the same source of truth
  // PaymentsService uses for the outstanding balance it enforces.
  private async allocatedTotals(
    invoiceIds: string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    if (invoiceIds.length === 0) return new Map();
    const rows = await this.prisma.paymentAllocation.groupBy({
      by: ['invoiceId'],
      where: { invoiceId: { in: invoiceIds } },
      _sum: { amount: true },
    });
    return new Map(
      rows.map((row) => [
        row.invoiceId,
        row._sum.amount ?? new Prisma.Decimal(0),
      ]),
    );
  }

  private toInvoiceDto(
    invoice: InvoiceRow,
    allocated: Prisma.Decimal = new Prisma.Decimal(0),
  ): MyInvoiceDto {
    const total = new Prisma.Decimal(invoice.total);
    const balance = Prisma.Decimal.max(total.minus(allocated), 0);
    const dto = new MyInvoiceDto();
    dto.id = invoice.id;
    dto.invoiceNumber = invoice.invoiceNumber;
    dto.billingPeriodStart = invoice.billingPeriodStart;
    dto.billingPeriodEnd = invoice.billingPeriodEnd;
    dto.issueDate = invoice.issueDate;
    dto.dueDate = invoice.dueDate;
    dto.subtotal = invoice.subtotal.toFixed(2);
    dto.discount = invoice.discount.toFixed(2);
    dto.tax = invoice.tax.toFixed(2);
    dto.total = total.toFixed(2);
    dto.amountPaid = new Prisma.Decimal(allocated).toFixed(2);
    dto.balanceDue = balance.toFixed(2);
    dto.currency = invoice.currency;
    dto.status = invoice.status;
    dto.isPayable =
      PAYABLE_STATUSES.includes(invoice.status) && balance.greaterThan(0);
    dto.propertyName = invoice.residency.property.name;
    return dto;
  }

  private toPaymentDto(payment: PaymentRow): MyPaymentDto {
    return {
      id: payment.id,
      invoiceId: payment.invoiceId,
      invoiceNumber: payment.invoice.invoiceNumber,
      amount: payment.amount.toFixed(2),
      currency: payment.currency,
      status: payment.status,
      method: payment.method,
      providerPaymentId: payment.providerPaymentId,
      failureCode: payment.failureCode,
      failureMessage: payment.failureMessage,
      paidAt: payment.paidAt,
      createdAt: payment.createdAt,
    };
  }
}
