import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { ComplaintsService } from './complaints.service';
import { ComplaintActivityService } from './complaint-activity.service';
import { DomainEventBusService } from '../../common/events/domain-event-bus.service';
import { ComplaintLifecycleService } from './complaint-lifecycle.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Manager',
    email: 'manager@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

function buildComplaint(overrides: Partial<any> = {}) {
  return {
    id: 'complaint-1',
    organizationId: 'org-1',
    status: 'OPEN',
    priority: 'MEDIUM',
    assignedToUserId: null,
    tenant: { userId: 'tenant-user-1' },
    ...overrides,
  };
}

describe('ComplaintLifecycleService', () => {
  let service: ComplaintLifecycleService;
  let prisma: any;
  let memberships: { getActiveMembership: jest.Mock };
  let complaints: {
    getOrgComplaintForActionOrThrow: jest.Mock;
    assertOrganizationWritableOrThrow: jest.Mock;
  };
  let activity: { record: jest.Mock };
  let eventBus: { emit: jest.Mock };

  function mockTx(updateManyCount = 1) {
    const tx = {
      complaint: {
        updateMany: jest.fn().mockResolvedValue({ count: updateManyCount }),
        update: jest.fn(),
        findUniqueOrThrow: jest
          .fn()
          .mockResolvedValue(buildComplaint({ status: 'ASSIGNED' })),
      },
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
    return tx;
  }

  beforeEach(() => {
    prisma = {
      complaint: { findFirst: jest.fn() },
      $transaction: jest.fn(),
    };
    memberships = { getActiveMembership: jest.fn() };
    complaints = {
      getOrgComplaintForActionOrThrow: jest.fn(),
      assertOrganizationWritableOrThrow: jest.fn().mockResolvedValue(undefined),
    };
    activity = { record: jest.fn() };
    eventBus = { emit: jest.fn().mockResolvedValue(undefined) };

    service = new ComplaintLifecycleService(
      prisma,
      memberships as unknown as MembershipsService,
      complaints as unknown as ComplaintsService,
      activity as unknown as ComplaintActivityService,
      eventBus as unknown as DomainEventBusService,
    );
  });

  describe('assign', () => {
    it('assigns to an active OWNER/MANAGER/STAFF member and transitions OPEN -> ASSIGNED', async () => {
      complaints.getOrgComplaintForActionOrThrow.mockResolvedValue(
        buildComplaint(),
      );
      memberships.getActiveMembership.mockResolvedValue({ role: 'STAFF' });
      const tx = mockTx();

      await service.assign(buildUser(), 'complaint-1', {
        assignedToUserId: 'staff-1',
      });

      expect(tx.complaint.updateMany).toHaveBeenCalledWith({
        where: { id: 'complaint-1', status: { in: ['OPEN', 'ASSIGNED'] } },
        data: { assignedToUserId: 'staff-1', status: 'ASSIGNED' },
      });
      expect(activity.record).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ type: 'ASSIGNED', newAssigneeId: 'staff-1' }),
      );
    });

    it('rejects assigning to someone outside the organization', async () => {
      complaints.getOrgComplaintForActionOrThrow.mockResolvedValue(
        buildComplaint(),
      );
      memberships.getActiveMembership.mockResolvedValue(null);

      await expect(
        service.assign(buildUser(), 'complaint-1', {
          assignedToUserId: 'outsider',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.COMPLAINT_ASSIGNEE_NOT_IN_ORGANIZATION,
      });
    });

    it('rejects assigning to a STUDENT-role member', async () => {
      complaints.getOrgComplaintForActionOrThrow.mockResolvedValue(
        buildComplaint(),
      );
      memberships.getActiveMembership.mockResolvedValue({ role: 'STUDENT' });

      await expect(
        service.assign(buildUser(), 'complaint-1', {
          assignedToUserId: 'student-1',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.COMPLAINT_ASSIGNMENT_NOT_ALLOWED,
      });
    });

    it('rejects assigning an already IN_PROGRESS complaint', async () => {
      complaints.getOrgComplaintForActionOrThrow.mockResolvedValue(
        buildComplaint({ status: 'IN_PROGRESS' }),
      );

      await expect(
        service.assign(buildUser(), 'complaint-1', {
          assignedToUserId: 'staff-1',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.COMPLAINT_INVALID_STATUS_TRANSITION,
      });
    });

    it('translates a lost concurrency race (updateMany count 0) into the same invalid-transition error', async () => {
      complaints.getOrgComplaintForActionOrThrow.mockResolvedValue(
        buildComplaint(),
      );
      memberships.getActiveMembership.mockResolvedValue({ role: 'STAFF' });
      mockTx(0);

      await expect(
        service.assign(buildUser(), 'complaint-1', {
          assignedToUserId: 'staff-1',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.COMPLAINT_INVALID_STATUS_TRANSITION,
      });
    });
  });

  describe('start / resolve / close / cancel transitions', () => {
    it('start: STAFF may only start a complaint assigned to themselves', async () => {
      prisma.complaint.findFirst.mockResolvedValue(
        buildComplaint({
          status: 'ASSIGNED',
          assignedToUserId: 'someone-else',
        }),
      );
      memberships.getActiveMembership.mockResolvedValue({ role: 'STAFF' });

      await expect(
        service.start(buildUser(), 'complaint-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.COMPLAINT_ASSIGNMENT_NOT_ALLOWED,
      });
    });

    it('start: STAFF can start their own assigned complaint', async () => {
      prisma.complaint.findFirst.mockResolvedValue(
        buildComplaint({ status: 'ASSIGNED', assignedToUserId: 'user-1' }),
      );
      memberships.getActiveMembership.mockResolvedValue({ role: 'STAFF' });
      const tx = mockTx();
      tx.complaint.findUniqueOrThrow.mockResolvedValue(
        buildComplaint({ status: 'IN_PROGRESS' }),
      );

      const result = await service.start(buildUser(), 'complaint-1');
      expect(result.status).toBe('IN_PROGRESS');
    });

    it('resolve: rejects resolving a complaint that is not IN_PROGRESS', async () => {
      prisma.complaint.findFirst.mockResolvedValue(
        buildComplaint({ status: 'OPEN' }),
      );
      memberships.getActiveMembership.mockResolvedValue({ role: 'MANAGER' });

      await expect(
        service.resolve(buildUser(), 'complaint-1', {
          resolutionNote: 'fixed',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.COMPLAINT_INVALID_STATUS_TRANSITION,
      });
    });

    it('resolve: transitions IN_PROGRESS -> RESOLVED with a resolution note', async () => {
      prisma.complaint.findFirst.mockResolvedValue(
        buildComplaint({ status: 'IN_PROGRESS', assignedToUserId: 'user-1' }),
      );
      memberships.getActiveMembership.mockResolvedValue({ role: 'OWNER' });
      const tx = mockTx();
      tx.complaint.findUniqueOrThrow.mockResolvedValue(
        buildComplaint({ status: 'RESOLVED' }),
      );

      const result = await service.resolve(buildUser(), 'complaint-1', {
        resolutionNote: 'Fixed the leak',
      });
      expect(result.status).toBe('RESOLVED');
      expect(tx.complaint.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'complaint-1', status: 'IN_PROGRESS' },
          data: expect.objectContaining({
            status: 'RESOLVED',
            resolutionNote: 'Fixed the leak',
          }),
        }),
      );
    });

    it('close: RESOLVED -> CLOSED, OWNER/MANAGER only', async () => {
      complaints.getOrgComplaintForActionOrThrow.mockResolvedValue(
        buildComplaint({ status: 'RESOLVED' }),
      );
      const tx = mockTx();
      tx.complaint.findUniqueOrThrow.mockResolvedValue(
        buildComplaint({ status: 'CLOSED' }),
      );

      const result = await service.close(buildUser(), 'complaint-1');
      expect(result.status).toBe('CLOSED');
    });

    it('cancel: the reporting tenant can cancel their own OPEN complaint', async () => {
      prisma.complaint.findFirst.mockResolvedValue(
        buildComplaint({ status: 'OPEN' }),
      );
      const tx = mockTx();
      tx.complaint.findUniqueOrThrow.mockResolvedValue(
        buildComplaint({ status: 'CANCELLED' }),
      );

      const result = await service.cancel(
        buildUser({ id: 'tenant-user-1' }),
        'complaint-1',
      );
      expect(result.status).toBe('CANCELLED');
    });

    it('cancel: rejects an unrelated tenant', async () => {
      prisma.complaint.findFirst.mockResolvedValue(
        buildComplaint({ status: 'OPEN' }),
      );
      memberships.getActiveMembership.mockResolvedValue(null);

      await expect(
        service.cancel(buildUser({ id: 'unrelated-user' }), 'complaint-1'),
      ).rejects.toMatchObject({ code: ErrorCode.COMPLAINT_NOT_FOUND });
    });

    it('cancel: rejects cancelling a complaint that already moved past OPEN', async () => {
      prisma.complaint.findFirst.mockResolvedValue(
        buildComplaint({ status: 'ASSIGNED' }),
      );

      await expect(
        service.cancel(buildUser({ id: 'tenant-user-1' }), 'complaint-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.COMPLAINT_INVALID_STATUS_TRANSITION,
      });
    });
  });

  describe('subscription access', () => {
    it('rejects a lifecycle action when the organization’s subscription is write-blocked', async () => {
      complaints.getOrgComplaintForActionOrThrow.mockResolvedValue(
        buildComplaint(),
      );
      complaints.assertOrganizationWritableOrThrow.mockRejectedValue(
        Object.assign(new Error('blocked'), {
          code: ErrorCode.SUBSCRIPTION_SUSPENDED,
        }),
      );

      await expect(
        service.assign(buildUser(), 'complaint-1', {
          assignedToUserId: 'staff-1',
        }),
      ).rejects.toMatchObject({ code: ErrorCode.SUBSCRIPTION_SUSPENDED });
    });
  });
});
