import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { DomainEventBusService } from '../../../common/events/domain-event-bus.service';
import { TenantApplicationsService } from './tenant-applications.service';
import { PropertyVisitsService } from './property-visits.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'manager-1',
    name: 'Manager',
    email: 'manager@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

function buildApplication(overrides: Partial<any> = {}) {
  return {
    id: 'app-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    applicantUserId: 'applicant-1',
    status: 'SUBMITTED',
    ...overrides,
  };
}

function buildVisit(overrides: Partial<any> = {}) {
  return {
    id: 'visit-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    applicationId: 'app-1',
    applicantUserId: 'applicant-1',
    status: 'REQUESTED',
    scheduledStartAt: null,
    scheduledEndAt: null,
    createdByUserId: 'applicant-1',
    ...overrides,
  };
}

describe('PropertyVisitsService', () => {
  let service: PropertyVisitsService;
  let prisma: any;
  let memberships: { getActiveMembership: jest.Mock };
  let subscriptions: { isOrganizationWriteBlocked: jest.Mock };
  let applications: {
    getOrgApplicationOrThrow: jest.Mock;
    getApplicantApplicationOrThrow: jest.Mock;
    isActiveStatus: jest.Mock;
  };
  let eventBus: { emit: jest.Mock };

  function mockTx(conflict: any, createResult: any) {
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(undefined),
      propertyVisit: {
        findFirst: jest.fn().mockResolvedValue(conflict),
        create: jest.fn().mockResolvedValue(createResult),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        findUniqueOrThrow: jest.fn().mockResolvedValue(createResult),
      },
      tenantApplication: {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
    return tx;
  }

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(),
      propertyVisit: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        updateMany: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
    };
    memberships = { getActiveMembership: jest.fn() };
    subscriptions = {
      isOrganizationWriteBlocked: jest.fn().mockResolvedValue(false),
    };
    applications = {
      getOrgApplicationOrThrow: jest.fn(),
      getApplicantApplicationOrThrow: jest.fn(),
      isActiveStatus: jest.fn().mockReturnValue(true),
    };
    eventBus = { emit: jest.fn().mockResolvedValue(undefined) };

    service = new PropertyVisitsService(
      prisma,
      memberships as unknown as MembershipsService,
      subscriptions as unknown as SubscriptionsService,
      applications as unknown as TenantApplicationsService,
      eventBus as unknown as DomainEventBusService,
    );
  });

  describe('request', () => {
    it('creates a REQUESTED visit for the applicant’s own active application', async () => {
      applications.getApplicantApplicationOrThrow.mockResolvedValue(
        buildApplication(),
      );
      prisma.propertyVisit.create.mockResolvedValue(buildVisit());

      const result = await service.request(
        buildUser({ id: 'applicant-1' }),
        'app-1',
        {},
      );
      expect(result.status).toBe('REQUESTED');
    });

    it('rejects a visit request for an inactive application', async () => {
      applications.getApplicantApplicationOrThrow.mockResolvedValue(
        buildApplication({ status: 'REJECTED' }),
      );
      applications.isActiveStatus.mockReturnValue(false);

      await expect(
        service.request(buildUser({ id: 'applicant-1' }), 'app-1', {}),
      ).rejects.toMatchObject({ code: ErrorCode.APPLICATION_INVALID_STATE });
    });
  });

  describe('scheduleNew', () => {
    it('creates a SCHEDULED visit when the time range has no conflict', async () => {
      applications.getOrgApplicationOrThrow.mockResolvedValue(
        buildApplication(),
      );
      const created = buildVisit({
        status: 'SCHEDULED',
        scheduledStartAt: new Date('2027-01-01T10:00:00Z'),
        scheduledEndAt: new Date('2027-01-01T11:00:00Z'),
      });
      mockTx(null, created);

      const result = await service.scheduleNew(buildUser(), 'app-1', {
        scheduledStartAt: '2027-01-01T10:00:00Z',
        scheduledEndAt: '2027-01-01T11:00:00Z',
      });

      expect(result.status).toBe('SCHEDULED');
      expect(eventBus.emit).toHaveBeenCalledWith('VISIT_SCHEDULED', {
        visitId: 'visit-1',
      });
    });

    it('rejects an overlapping time range with VISIT_TIME_CONFLICT', async () => {
      applications.getOrgApplicationOrThrow.mockResolvedValue(
        buildApplication(),
      );
      mockTx(buildVisit({ status: 'SCHEDULED' }), null);

      await expect(
        service.scheduleNew(buildUser(), 'app-1', {
          scheduledStartAt: '2027-01-01T10:00:00Z',
          scheduledEndAt: '2027-01-01T11:00:00Z',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VISIT_TIME_CONFLICT });
    });

    it('rejects an end time before the start time', async () => {
      applications.getOrgApplicationOrThrow.mockResolvedValue(
        buildApplication(),
      );

      await expect(
        service.scheduleNew(buildUser(), 'app-1', {
          scheduledStartAt: '2027-01-01T11:00:00Z',
          scheduledEndAt: '2027-01-01T10:00:00Z',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.VISIT_TIME_REQUIRED });
    });
  });

  describe('complete / no-show', () => {
    it('transitions SCHEDULED -> COMPLETED', async () => {
      prisma.propertyVisit.findFirst.mockResolvedValue(
        buildVisit({ status: 'SCHEDULED' }),
      );
      memberships.getActiveMembership.mockResolvedValue({ role: 'MANAGER' });
      prisma.propertyVisit.updateMany.mockResolvedValue({ count: 1 });
      prisma.propertyVisit.findUniqueOrThrow.mockResolvedValue(
        buildVisit({ status: 'COMPLETED' }),
      );

      const result = await service.complete(buildUser(), 'visit-1');
      expect(result.status).toBe('COMPLETED');
    });

    it('rejects completing a REQUESTED (never-scheduled) visit', async () => {
      prisma.propertyVisit.findFirst.mockResolvedValue(
        buildVisit({ status: 'REQUESTED' }),
      );
      memberships.getActiveMembership.mockResolvedValue({ role: 'MANAGER' });
      prisma.propertyVisit.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        service.complete(buildUser(), 'visit-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.VISIT_INVALID_STATE,
      });
    });
  });

  describe('cancel', () => {
    it('allows the applicant to cancel their own visit', async () => {
      prisma.propertyVisit.findUnique.mockResolvedValue(
        buildVisit({ status: 'SCHEDULED' }),
      );
      prisma.propertyVisit.updateMany.mockResolvedValue({ count: 1 });
      prisma.propertyVisit.findUniqueOrThrow.mockResolvedValue(
        buildVisit({ status: 'CANCELLED' }),
      );

      const result = await service.cancel(
        buildUser({ id: 'applicant-1' }),
        'visit-1',
        {},
      );
      expect(result.status).toBe('CANCELLED');
      expect(eventBus.emit).toHaveBeenCalledWith('VISIT_CANCELLED', {
        visitId: 'visit-1',
      });
    });

    it('404s for an unrelated caller (not the applicant, not an org member)', async () => {
      prisma.propertyVisit.findUnique.mockResolvedValue(
        buildVisit({ status: 'SCHEDULED' }),
      );
      memberships.getActiveMembership.mockResolvedValue(null);

      await expect(
        service.cancel(buildUser({ id: 'stranger-1' }), 'visit-1', {}),
      ).rejects.toMatchObject({ code: ErrorCode.VISIT_NOT_FOUND });
    });
  });

  describe('authorization', () => {
    it('404s an org read when the caller has no active membership (STAFF included)', async () => {
      applications.getOrgApplicationOrThrow.mockRejectedValue(
        Object.assign(new Error('not found'), {
          code: ErrorCode.APPLICATION_NOT_FOUND,
        }),
      );
      await expect(
        service.scheduleNew(buildUser(), 'app-1', {
          scheduledStartAt: '2027-01-01T10:00:00Z',
          scheduledEndAt: '2027-01-01T11:00:00Z',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.APPLICATION_NOT_FOUND });
    });
  });
});
