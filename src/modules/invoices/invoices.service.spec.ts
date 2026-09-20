import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { PropertiesService } from '../properties/properties.service';
import { ResidenciesService } from '../residencies/residencies.service';
import { InvoicesService } from './invoices.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Rahul',
    email: 'rahul@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

function p2002(target: string) {
  return new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
    code: 'P2002',
    clientVersion: '5.22.0',
    meta: { target },
  });
}

const utc = (y: number, m: number, d: number) =>
  new Date(Date.UTC(y, m - 1, d));

const fullPeriodResidency = {
  id: 'res-1',
  organizationId: 'org-1',
  startDate: utc(2026, 12, 1),
  actualEndDate: null,
};

const fullPeriodRentPlan = {
  id: 'plan-1',
  residencyId: 'res-1',
  amount: new Prisma.Decimal('8000.00'),
  dueDay: 5,
  effectiveFrom: utc(2026, 12, 1),
  effectiveTo: null,
  status: 'ACTIVE',
};

function buildInvoiceRow(overrides: Partial<any> = {}) {
  return {
    id: 'inv-1',
    residencyId: 'res-1',
    rentPlanId: 'plan-1',
    invoiceNumber: 'INV-2027-000001',
    billingPeriodStart: utc(2027, 1, 1),
    billingPeriodEnd: utc(2027, 1, 31),
    issueDate: null,
    dueDate: utc(2027, 1, 5),
    subtotal: new Prisma.Decimal('8000.00'),
    discount: new Prisma.Decimal('0'),
    tax: new Prisma.Decimal('0'),
    total: new Prisma.Decimal('8000.00'),
    currency: 'INR',
    status: 'DRAFT',
    createdAt: new Date(),
    items: [],
    ...overrides,
  };
}

describe('InvoicesService', () => {
  let service: InvoicesService;
  let prisma: {
    invoice: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
    };
    rentPlan: { findFirst: jest.Mock };
    $transaction: jest.Mock;
  };
  let memberships: {
    listActiveOrganizationIds: jest.Mock;
    getActiveMembership: jest.Mock;
    assertRole: jest.Mock;
  };
  let properties: { getAccessiblePropertyOrThrow: jest.Mock };
  let residencies: { getAccessibleResidencyOrThrow: jest.Mock };

  beforeEach(() => {
    prisma = {
      invoice: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      rentPlan: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    memberships = {
      listActiveOrganizationIds: jest.fn(),
      getActiveMembership: jest.fn(),
      assertRole: jest.fn(),
    };
    properties = { getAccessiblePropertyOrThrow: jest.fn() };
    residencies = { getAccessibleResidencyOrThrow: jest.fn() };
    service = new InvoicesService(
      prisma as any,
      memberships as unknown as MembershipsService,
      properties as unknown as PropertiesService,
      residencies as unknown as ResidenciesService,
    );

    residencies.getAccessibleResidencyOrThrow.mockResolvedValue(
      fullPeriodResidency,
    );
    prisma.invoice.findFirst.mockResolvedValue(null);
  });

  describe('generateForResidency', () => {
    it('generates a full-period invoice with the correct subtotal/total/dueDate/items', async () => {
      prisma.rentPlan.findFirst.mockResolvedValueOnce(fullPeriodRentPlan);
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([{ nextval: '1' }]),
          invoice: {
            create: jest.fn().mockResolvedValue(
              buildInvoiceRow({
                items: [
                  {
                    id: 'item-1',
                    description: 'Rent for January 2027',
                    itemType: 'RENT',
                    quantity: 1,
                    unitAmount: new Prisma.Decimal('8000.00'),
                    amount: new Prisma.Decimal('8000.00'),
                  },
                ],
              }),
            ),
          },
        }),
      );

      const result = await service.generateForResidency(buildUser(), 'res-1', {
        year: 2027,
        month: 1,
      });

      expect(result.subtotal).toBe('8000');
      expect(result.total).toBe('8000');
      expect(result.status).toBe('DRAFT');
      expect(result.items?.[0].description).toBe('Rent for January 2027');
      expect(result.dueDate.toISOString()).toBe(utc(2027, 1, 5).toISOString());
    });

    it('prorates the first invoice for a residency starting mid-month', async () => {
      residencies.getAccessibleResidencyOrThrow.mockResolvedValue({
        ...fullPeriodResidency,
        startDate: utc(2027, 1, 18),
      });
      prisma.rentPlan.findFirst.mockResolvedValueOnce({
        ...fullPeriodRentPlan,
        amount: new Prisma.Decimal('9000.00'),
        effectiveFrom: utc(2027, 1, 18),
      });
      let createdData: any;
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([{ nextval: '2' }]),
          invoice: {
            create: jest.fn().mockImplementation(({ data }: any) => {
              createdData = data;
              return buildInvoiceRow({
                subtotal: data.subtotal,
                total: data.total,
                items: [],
              });
            }),
          },
        }),
      );

      await service.generateForResidency(buildUser(), 'res-1', {
        year: 2027,
        month: 1,
      });

      // 9000 * 14/31 = 4064.52
      expect(createdData.subtotal.toString()).toBe('4064.52');
      expect(createdData.total.toString()).toBe('4064.52');
    });

    it('prorates the final invoice for a mid-month checkout', async () => {
      residencies.getAccessibleResidencyOrThrow.mockResolvedValue({
        ...fullPeriodResidency,
        actualEndDate: utc(2027, 1, 10),
      });
      prisma.rentPlan.findFirst.mockResolvedValueOnce(fullPeriodRentPlan);
      let createdData: any;
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          $queryRaw: jest.fn().mockResolvedValue([{ nextval: '3' }]),
          invoice: {
            create: jest.fn().mockImplementation(({ data }: any) => {
              createdData = data;
              return buildInvoiceRow({
                subtotal: data.subtotal,
                total: data.total,
              });
            }),
          },
        }),
      );

      await service.generateForResidency(buildUser(), 'res-1', {
        year: 2027,
        month: 1,
      });

      // 8000 * 10/31 = 2580.645... -> 2580.65
      expect(createdData.subtotal.toString()).toBe('2580.65');
    });

    it('rejects a billing period entirely before the residency started', async () => {
      residencies.getAccessibleResidencyOrThrow.mockResolvedValue({
        ...fullPeriodResidency,
        startDate: utc(2027, 3, 1),
      });

      await expect(
        service.generateForResidency(buildUser(), 'res-1', {
          year: 2027,
          month: 1,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_BILLING_PERIOD });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('rejects a billing period entirely after the residency ended', async () => {
      residencies.getAccessibleResidencyOrThrow.mockResolvedValue({
        ...fullPeriodResidency,
        actualEndDate: utc(2026, 12, 31),
      });

      await expect(
        service.generateForResidency(buildUser(), 'res-1', {
          year: 2027,
          month: 1,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_BILLING_PERIOD });
    });

    it('throws RENT_PLAN_NOT_FOUND when no rent plan covers the period', async () => {
      prisma.rentPlan.findFirst
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce(null);

      await expect(
        service.generateForResidency(buildUser(), 'res-1', {
          year: 2027,
          month: 1,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.RENT_PLAN_NOT_FOUND });
    });

    it('rejects a period where the rent plan changed mid-period (partial overlap only)', async () => {
      // No plan fully covers; a partially-overlapping one exists.
      prisma.rentPlan.findFirst
        .mockResolvedValueOnce(null) // full coverage check
        .mockResolvedValueOnce({ id: 'plan-partial' }); // partial overlap check

      await expect(
        service.generateForResidency(buildUser(), 'res-1', {
          year: 2027,
          month: 1,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_BILLING_PERIOD });
    });

    it('rejects a duplicate billing period (pre-check)', async () => {
      prisma.rentPlan.findFirst.mockResolvedValueOnce(fullPeriodRentPlan);
      prisma.invoice.findFirst.mockResolvedValue(buildInvoiceRow());

      await expect(
        service.generateForResidency(buildUser(), 'res-1', {
          year: 2027,
          month: 1,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.DUPLICATE_BILLING_PERIOD });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    describe('concurrency: the DB unique constraint is the real guard', () => {
      it('translates invoices_residency_billing_period_unique violation into DUPLICATE_BILLING_PERIOD', async () => {
        prisma.rentPlan.findFirst.mockResolvedValueOnce(fullPeriodRentPlan);
        prisma.$transaction.mockRejectedValue(
          p2002('invoices_residency_billing_period_unique'),
        );

        await expect(
          service.generateForResidency(buildUser(), 'res-1', {
            year: 2027,
            month: 1,
          }),
        ).rejects.toMatchObject({ code: ErrorCode.DUPLICATE_BILLING_PERIOD });
      });

      it('never leaks a raw unrecognised database error', async () => {
        prisma.rentPlan.findFirst.mockResolvedValueOnce(fullPeriodRentPlan);
        const dbError = new Error('connection reset');
        prisma.$transaction.mockRejectedValue(dbError);

        await expect(
          service.generateForResidency(buildUser(), 'res-1', {
            year: 2027,
            month: 1,
          }),
        ).rejects.toBe(dbError);
      });
    });

    it('rejects a STAFF member trying to generate an invoice', async () => {
      memberships.assertRole.mockImplementation(() => {
        throw Object.assign(new Error('forbidden'), {
          code: ErrorCode.INSUFFICIENT_ROLE,
        });
      });

      await expect(
        service.generateForResidency(buildUser(), 'res-1', {
          year: 2027,
          month: 1,
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_ROLE });
    });
  });

  describe('findOne / BOLA + lazy overdue evaluation', () => {
    it('returns the invoice when accessible', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        ...buildInvoiceRow(),
        residency: { property: { organizationId: 'org-1' } },
      });
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);

      const result = await service.findOne(buildUser(), 'inv-1');
      expect(result.id).toBe('inv-1');
    });

    it('returns INVOICE_NOT_FOUND for an invoice in another organization (IDOR)', async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.invoice.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne(buildUser(), 'inv-in-org-99'),
      ).rejects.toMatchObject({
        code: ErrorCode.INVOICE_NOT_FOUND,
      });
    });

    it('lazily transitions an ISSUED invoice past its dueDate to OVERDUE on read', async () => {
      const pastDue = utc(2020, 1, 1);
      prisma.invoice.findFirst.mockResolvedValue({
        ...buildInvoiceRow({ status: 'ISSUED', dueDate: pastDue }),
        residency: { property: { organizationId: 'org-1' } },
      });
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.invoice.update.mockResolvedValue(
        buildInvoiceRow({ status: 'OVERDUE', dueDate: pastDue }),
      );

      const result = await service.findOne(buildUser(), 'inv-1');

      expect(prisma.invoice.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'inv-1' },
          data: { status: 'OVERDUE' },
        }),
      );
      expect(result.status).toBe('OVERDUE');
    });

    it('does not transition an ISSUED invoice that is not yet due', async () => {
      const futureDue = new Date(Date.now() + 1000 * 60 * 60 * 24 * 30);
      prisma.invoice.findFirst.mockResolvedValue({
        ...buildInvoiceRow({ status: 'ISSUED', dueDate: futureDue }),
        residency: { property: { organizationId: 'org-1' } },
      });
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);

      const result = await service.findOne(buildUser(), 'inv-1');

      expect(prisma.invoice.update).not.toHaveBeenCalled();
      expect(result.status).toBe('ISSUED');
    });
  });

  describe('update', () => {
    it('updates dueDate on a DRAFT invoice', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        ...buildInvoiceRow(),
        residency: { property: { organizationId: 'org-1' } },
      });
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.invoice.update.mockResolvedValue(
        buildInvoiceRow({ dueDate: utc(2027, 1, 10) }),
      );

      const result = await service.update(buildUser(), 'inv-1', {
        dueDate: '2027-01-10T00:00:00.000Z',
      });
      expect(result.dueDate).toEqual(utc(2027, 1, 10));
    });

    it('rejects updating an ISSUED invoice', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        ...buildInvoiceRow({ status: 'ISSUED' }),
        residency: { property: { organizationId: 'org-1' } },
      });
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);

      await expect(
        service.update(buildUser(), 'inv-1', {
          dueDate: '2027-01-10T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_INVOICE_STATE });
      expect(prisma.invoice.update).not.toHaveBeenCalled();
    });
  });

  describe('issue', () => {
    it('issues a DRAFT invoice', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        ...buildInvoiceRow(),
        residency: { property: { organizationId: 'org-1' } },
      });
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.invoice.update.mockResolvedValue(
        buildInvoiceRow({ status: 'ISSUED', issueDate: new Date() }),
      );

      const result = await service.issue(buildUser(), 'inv-1');
      expect(result.status).toBe('ISSUED');
    });

    it('rejects issuing an already-issued invoice', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        ...buildInvoiceRow({ status: 'ISSUED' }),
        residency: { property: { organizationId: 'org-1' } },
      });
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);

      await expect(service.issue(buildUser(), 'inv-1')).rejects.toMatchObject({
        code: ErrorCode.INVOICE_ALREADY_ISSUED,
      });
    });

    it('rejects issuing a voided invoice', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        ...buildInvoiceRow({ status: 'VOID' }),
        residency: { property: { organizationId: 'org-1' } },
      });
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);

      await expect(service.issue(buildUser(), 'inv-1')).rejects.toMatchObject({
        code: ErrorCode.INVOICE_ALREADY_VOID,
      });
    });
  });

  describe('voidInvoice', () => {
    it('voids a DRAFT invoice', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        ...buildInvoiceRow(),
        residency: { property: { organizationId: 'org-1' } },
      });
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.invoice.update.mockResolvedValue(
        buildInvoiceRow({ status: 'VOID' }),
      );

      const result = await service.voidInvoice(buildUser(), 'inv-1');
      expect(result.status).toBe('VOID');
    });

    it('voids an ISSUED invoice', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        ...buildInvoiceRow({ status: 'ISSUED' }),
        residency: { property: { organizationId: 'org-1' } },
      });
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.invoice.update.mockResolvedValue(
        buildInvoiceRow({ status: 'VOID' }),
      );

      const result = await service.voidInvoice(buildUser(), 'inv-1');
      expect(result.status).toBe('VOID');
    });

    it('rejects voiding an already-voided invoice', async () => {
      prisma.invoice.findFirst.mockResolvedValue({
        ...buildInvoiceRow({ status: 'VOID' }),
        residency: { property: { organizationId: 'org-1' } },
      });
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);

      await expect(
        service.voidInvoice(buildUser(), 'inv-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.INVOICE_ALREADY_VOID,
      });
      expect(prisma.invoice.update).not.toHaveBeenCalled();
    });
  });
});
