import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { SubscriptionInvoicesService } from './subscription-invoices.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Owner',
    email: 'owner@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

function buildPlan(overrides: Partial<any> = {}) {
  return {
    id: 'plan-1',
    price: new Prisma.Decimal('499.00'),
    currency: 'INR',
    ...overrides,
  };
}

describe('SubscriptionInvoicesService', () => {
  let service: SubscriptionInvoicesService;
  let prisma: {
    subscriptionInvoice: { findMany: jest.Mock; findFirst: jest.Mock };
  };
  let memberships: {
    listActiveOrganizationIds: jest.Mock;
    getActiveMembership: jest.Mock;
    assertOrganizationAccess: jest.Mock;
    assertRole: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      subscriptionInvoice: { findMany: jest.fn(), findFirst: jest.fn() },
    };
    memberships = {
      listActiveOrganizationIds: jest.fn(),
      getActiveMembership: jest.fn(),
      assertOrganizationAccess: jest.fn(),
      assertRole: jest.fn(),
    };
    service = new SubscriptionInvoicesService(
      prisma as any,
      memberships as unknown as MembershipsService,
    );
  });

  describe('generateForPeriod', () => {
    it('snapshots the plan price and generates a concurrency-safe invoice number', async () => {
      const tx = {
        $queryRaw: jest.fn().mockResolvedValue([{ nextval: '7' }]),
        subscriptionInvoice: {
          create: jest.fn().mockImplementation(({ data }) => data),
        },
      };
      const plan = buildPlan();

      const result = await service.generateForPeriod(
        tx as any,
        'org-1',
        'sub-1',
        plan as any,
        new Date('2027-01-01'),
        new Date('2027-01-31'),
        new Date('2027-01-01'),
      );

      expect(result.invoiceNumber).toMatch(/^SAAS-\d{4}-000007$/);
      expect(result.subtotal.toString()).toBe('499');
      expect(result.total.toString()).toBe('499');
      expect(result.status).toBe('ISSUED');
    });
  });

  describe('findForOrganization', () => {
    it('rejects a MANAGER (OWNER-only billing access)', async () => {
      memberships.assertOrganizationAccess.mockResolvedValue({
        membership: { role: 'MANAGER' },
      });
      memberships.assertRole.mockImplementation(() => {
        throw Object.assign(new Error('forbidden'), {
          code: ErrorCode.INSUFFICIENT_ROLE,
        });
      });

      await expect(
        service.findForOrganization(buildUser(), 'org-1'),
      ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_ROLE });
    });

    it('returns invoices for an OWNER', async () => {
      memberships.assertOrganizationAccess.mockResolvedValue({
        membership: { role: 'OWNER' },
      });
      prisma.subscriptionInvoice.findMany.mockResolvedValue([
        {
          id: 'inv-1',
          subtotal: new Prisma.Decimal(1),
          tax: new Prisma.Decimal(0),
          total: new Prisma.Decimal(1),
        },
      ]);

      const result = await service.findForOrganization(buildUser(), 'org-1');
      expect(result).toHaveLength(1);
    });
  });

  describe('getAccessibleInvoiceOrThrow (BOLA)', () => {
    it('returns SUBSCRIPTION_INVOICE_NOT_FOUND for an invoice in another organization', async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.subscriptionInvoice.findFirst.mockResolvedValue(null);

      await expect(
        service.getAccessibleInvoiceOrThrow(buildUser(), 'inv-in-org-99'),
      ).rejects.toMatchObject({
        code: ErrorCode.SUBSCRIPTION_INVOICE_NOT_FOUND,
      });
    });
  });
});
