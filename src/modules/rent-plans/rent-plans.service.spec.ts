import { Prisma } from '@prisma/client';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { ResidenciesService } from '../residencies/residencies.service';
import { RentPlansService } from './rent-plans.service';

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

const accessibleResidency = { id: 'res-1', organizationId: 'org-1' };

describe('RentPlansService', () => {
  let service: RentPlansService;
  let prisma: {
    rentPlan: {
      create: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let memberships: {
    listActiveOrganizationIds: jest.Mock;
    getActiveMembership: jest.Mock;
    assertRole: jest.Mock;
  };
  let residencies: { getAccessibleResidencyOrThrow: jest.Mock };

  beforeEach(() => {
    prisma = {
      rentPlan: { create: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
      $transaction: jest.fn(),
    };
    memberships = {
      listActiveOrganizationIds: jest.fn(),
      getActiveMembership: jest.fn(),
      assertRole: jest.fn(),
    };
    residencies = { getAccessibleResidencyOrThrow: jest.fn() };
    service = new RentPlansService(
      prisma as any,
      memberships as unknown as MembershipsService,
      residencies as unknown as ResidenciesService,
    );
    residencies.getAccessibleResidencyOrThrow.mockResolvedValue(
      accessibleResidency,
    );
  });

  describe('create', () => {
    it('creates the first rent plan for a residency (no existing plan)', async () => {
      prisma.rentPlan.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          rentPlan: {
            update: jest.fn(),
            create: jest.fn().mockResolvedValue({
              id: 'plan-1',
              residencyId: 'res-1',
              amount: new Prisma.Decimal('8000.00'),
              currency: 'INR',
              billingCycle: 'MONTHLY',
              dueDay: 5,
              effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
              effectiveTo: null,
              status: 'ACTIVE',
              createdAt: new Date(),
            }),
          },
        }),
      );

      const result = await service.create(buildUser(), 'res-1', {
        amount: '8000.00',
        dueDay: 5,
        effectiveFrom: '2027-01-01T00:00:00.000Z',
      });

      expect(result.amount).toBe('8000');
      expect(result.status).toBe('ACTIVE');
    });

    it('rejects a zero or negative amount', async () => {
      await expect(
        service.create(buildUser(), 'res-1', {
          amount: '0.00',
          dueDay: 5,
          effectiveFrom: '2027-01-01T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_RENT_PLAN });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it("rejects a new plan whose effectiveFrom is not after the current plan's", async () => {
      prisma.rentPlan.findFirst.mockResolvedValue({
        id: 'plan-old',
        effectiveFrom: new Date('2027-03-01T00:00:00.000Z'),
      });

      await expect(
        service.create(buildUser(), 'res-1', {
          amount: '9000.00',
          dueDay: 5,
          effectiveFrom: '2027-01-01T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_RENT_PLAN });
      expect(prisma.$transaction).not.toHaveBeenCalled();
    });

    it('closes out the existing ACTIVE plan when creating a new one (history preserved)', async () => {
      const oldPlan = {
        id: 'plan-old',
        effectiveFrom: new Date('2027-01-01T00:00:00.000Z'),
      };
      prisma.rentPlan.findFirst.mockResolvedValue(oldPlan);
      const updateOldMock = jest.fn();
      prisma.$transaction.mockImplementation(async (fn: any) =>
        fn({
          rentPlan: {
            update: updateOldMock,
            create: jest.fn().mockResolvedValue({
              id: 'plan-new',
              residencyId: 'res-1',
              amount: new Prisma.Decimal('9000.00'),
              currency: 'INR',
              billingCycle: 'MONTHLY',
              dueDay: 5,
              effectiveFrom: new Date('2027-04-01T00:00:00.000Z'),
              effectiveTo: null,
              status: 'ACTIVE',
              createdAt: new Date(),
            }),
          },
        }),
      );

      const result = await service.create(buildUser(), 'res-1', {
        amount: '9000.00',
        dueDay: 5,
        effectiveFrom: '2027-04-01T00:00:00.000Z',
      });

      expect(updateOldMock).toHaveBeenCalledWith({
        where: { id: 'plan-old' },
        data: {
          status: 'INACTIVE',
          effectiveTo: new Date('2027-04-01T00:00:00.000Z'),
        },
      });
      expect(result.amount).toBe('9000');
    });

    it('translates a concurrent-creation unique violation into INVALID_RENT_PLAN', async () => {
      prisma.rentPlan.findFirst.mockResolvedValue(null);
      prisma.$transaction.mockRejectedValue(
        p2002('rent_plans_active_residency_unique'),
      );

      await expect(
        service.create(buildUser(), 'res-1', {
          amount: '8000.00',
          dueDay: 5,
          effectiveFrom: '2027-01-01T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_RENT_PLAN });
    });

    it('rejects a STAFF member trying to create a rent plan', async () => {
      memberships.assertRole.mockImplementation(() => {
        throw Object.assign(new Error('forbidden'), {
          code: ErrorCode.INSUFFICIENT_ROLE,
        });
      });

      await expect(
        service.create(buildUser(), 'res-1', {
          amount: '8000.00',
          dueDay: 5,
          effectiveFrom: '2027-01-01T00:00:00.000Z',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_ROLE });
    });
  });

  describe('findCurrent', () => {
    it('returns the ACTIVE plan', async () => {
      prisma.rentPlan.findFirst.mockResolvedValue({
        id: 'plan-1',
        residencyId: 'res-1',
        amount: new Prisma.Decimal('8000.00'),
        currency: 'INR',
        billingCycle: 'MONTHLY',
        dueDay: 5,
        effectiveFrom: new Date(),
        effectiveTo: null,
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      const result = await service.findCurrent(buildUser(), 'res-1');
      expect(result.id).toBe('plan-1');
    });

    it('throws RENT_PLAN_NOT_FOUND when there is no active plan', async () => {
      prisma.rentPlan.findFirst.mockResolvedValue(null);

      await expect(
        service.findCurrent(buildUser(), 'res-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.RENT_PLAN_NOT_FOUND,
      });
    });
  });

  describe('update', () => {
    const existingPlan = {
      id: 'plan-1',
      residencyId: 'res-1',
      amount: new Prisma.Decimal('8000.00'),
      currency: 'INR',
      billingCycle: 'MONTHLY',
      dueDay: 5,
      effectiveFrom: new Date(),
      effectiveTo: null,
      status: 'ACTIVE',
      createdAt: new Date(),
      residency: { property: { organizationId: 'org-1' } },
    };

    it('updates dueDay only', async () => {
      prisma.rentPlan.findFirst.mockResolvedValue(existingPlan);
      prisma.rentPlan.update.mockResolvedValue({ ...existingPlan, dueDay: 10 });

      const result = await service.update(buildUser(), 'plan-1', {
        dueDay: 10,
      });
      expect(result.dueDay).toBe(10);
    });

    it('deactivates an ACTIVE plan', async () => {
      prisma.rentPlan.findFirst.mockResolvedValue(existingPlan);
      prisma.rentPlan.update.mockResolvedValue({
        ...existingPlan,
        status: 'INACTIVE',
      });

      const result = await service.update(buildUser(), 'plan-1', {
        deactivate: true,
      });
      expect(result.status).toBe('INACTIVE');
    });

    it('rejects deactivating an already-INACTIVE plan', async () => {
      prisma.rentPlan.findFirst.mockResolvedValue({
        ...existingPlan,
        status: 'INACTIVE',
      });

      await expect(
        service.update(buildUser(), 'plan-1', { deactivate: true }),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_RENT_PLAN });
      expect(prisma.rentPlan.update).not.toHaveBeenCalled();
    });

    it('propagates RENT_PLAN_NOT_FOUND for a rent plan in another organization (IDOR)', async () => {
      prisma.rentPlan.findFirst.mockResolvedValue(null);

      await expect(
        service.update(buildUser(), 'plan-in-other-org', { dueDay: 1 }),
      ).rejects.toMatchObject({ code: ErrorCode.RENT_PLAN_NOT_FOUND });
    });
  });
});
