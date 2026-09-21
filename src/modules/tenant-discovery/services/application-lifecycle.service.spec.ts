import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { SubscriptionsService } from '../../subscriptions/subscriptions.service';
import { DomainEventBusService } from '../../../common/events/domain-event-bus.service';
import { TenantApplicationsService } from './tenant-applications.service';
import { ApplicationActivityService } from './application-activity.service';
import { ApplicationLifecycleService } from './application-lifecycle.service';

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

describe('ApplicationLifecycleService', () => {
  let service: ApplicationLifecycleService;
  let prisma: any;
  let subscriptions: { isOrganizationWriteBlocked: jest.Mock };
  let applications: {
    getOrgApplicationOrThrow: jest.Mock;
    getApplicantApplicationOrThrow: jest.Mock;
  };
  let activity: { record: jest.Mock };
  let eventBus: { emit: jest.Mock };

  function mockTx(updateManyCount: number, resultStatus: string) {
    const tx = {
      tenantApplication: {
        updateMany: jest.fn().mockResolvedValue({ count: updateManyCount }),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue(buildApplication({ status: resultStatus })),
      },
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
    return tx;
  }

  beforeEach(() => {
    prisma = {
      $transaction: jest.fn(),
      tenantApplication: { updateMany: jest.fn() },
    };
    subscriptions = {
      isOrganizationWriteBlocked: jest.fn().mockResolvedValue(false),
    };
    applications = {
      getOrgApplicationOrThrow: jest.fn(),
      getApplicantApplicationOrThrow: jest.fn(),
    };
    activity = { record: jest.fn() };
    eventBus = { emit: jest.fn().mockResolvedValue(undefined) };

    service = new ApplicationLifecycleService(
      prisma,
      subscriptions as unknown as SubscriptionsService,
      applications as unknown as TenantApplicationsService,
      activity as unknown as ApplicationActivityService,
      eventBus as unknown as DomainEventBusService,
    );
  });

  describe('review', () => {
    it('transitions SUBMITTED -> UNDER_REVIEW and emits APPLICATION_REVIEW_STARTED', async () => {
      applications.getOrgApplicationOrThrow.mockResolvedValue(
        buildApplication(),
      );
      mockTx(1, 'UNDER_REVIEW');

      const result = await service.review(buildUser(), 'app-1');

      expect(result.status).toBe('UNDER_REVIEW');
      expect(eventBus.emit).toHaveBeenCalledWith('APPLICATION_REVIEW_STARTED', {
        applicationId: 'app-1',
      });
    });

    it('throws APPLICATION_INVALID_STATE when the row was already transitioned (lost race)', async () => {
      applications.getOrgApplicationOrThrow.mockResolvedValue(
        buildApplication(),
      );
      mockTx(0, 'UNDER_REVIEW');

      await expect(service.review(buildUser(), 'app-1')).rejects.toMatchObject({
        code: ErrorCode.APPLICATION_INVALID_STATE,
      });
    });

    it('blocks when the organization subscription is suspended', async () => {
      applications.getOrgApplicationOrThrow.mockResolvedValue(
        buildApplication(),
      );
      subscriptions.isOrganizationWriteBlocked.mockResolvedValue(true);

      await expect(service.review(buildUser(), 'app-1')).rejects.toMatchObject({
        code: ErrorCode.SUBSCRIPTION_SUSPENDED,
      });
    });
  });

  describe('approve', () => {
    it('transitions UNDER_REVIEW -> APPROVED without touching Residency/Invoice/Payment tables', async () => {
      applications.getOrgApplicationOrThrow.mockResolvedValue(
        buildApplication({ status: 'UNDER_REVIEW' }),
      );
      const tx = mockTx(1, 'APPROVED');

      const result = await service.approve(buildUser(), 'app-1');

      expect(result.status).toBe('APPROVED');
      expect(Object.keys(tx)).toEqual(['tenantApplication']);
      expect(eventBus.emit).toHaveBeenCalledWith('APPLICATION_APPROVED', {
        applicationId: 'app-1',
      });
    });
  });

  describe('reject', () => {
    it('stores only the public-safe reason, never internalReviewNotes', async () => {
      applications.getOrgApplicationOrThrow.mockResolvedValue(
        buildApplication({ status: 'UNDER_REVIEW' }),
      );
      const tx = mockTx(1, 'REJECTED');

      await service.reject(buildUser(), 'app-1', { reason: 'No vacancy' });

      expect(tx.tenantApplication.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ rejectionReason: 'No vacancy' }),
        }),
      );
    });
  });

  describe('withdraw', () => {
    it('allows the applicant to withdraw a SUBMITTED application', async () => {
      applications.getApplicantApplicationOrThrow.mockResolvedValue(
        buildApplication({ status: 'SUBMITTED' }),
      );
      mockTx(1, 'WITHDRAWN');

      const result = await service.withdraw(
        buildUser({ id: 'applicant-1' }),
        'app-1',
      );
      expect(result.status).toBe('WITHDRAWN');
    });

    it('rejects withdrawing an already-APPROVED application', async () => {
      applications.getApplicantApplicationOrThrow.mockResolvedValue(
        buildApplication({ status: 'APPROVED' }),
      );

      await expect(
        service.withdraw(buildUser({ id: 'applicant-1' }), 'app-1'),
      ).rejects.toMatchObject({ code: ErrorCode.APPLICATION_NOT_WITHDRAWABLE });
    });
  });

  describe('expireStaleApplications', () => {
    it('bulk-expires old SUBMITTED/UNDER_REVIEW applications past the cutoff', async () => {
      prisma.tenantApplication.updateMany.mockResolvedValue({ count: 3 });
      const result = await service.expireStaleApplications();
      expect(result).toEqual({ expired: 3 });
      expect(prisma.tenantApplication.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
          }),
          data: expect.objectContaining({ status: 'EXPIRED' }),
        }),
      );
    });
  });
});
