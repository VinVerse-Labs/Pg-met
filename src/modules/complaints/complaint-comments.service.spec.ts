import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { ComplaintsService } from './complaints.service';
import { ComplaintActivityService } from './complaint-activity.service';
import { ComplaintCommentsService } from './complaint-comments.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Someone',
    email: 'someone@example.com',
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
    tenant: { userId: 'tenant-user-1' },
    ...overrides,
  };
}

describe('ComplaintCommentsService', () => {
  let service: ComplaintCommentsService;
  let prisma: any;
  let memberships: { getActiveMembership: jest.Mock };
  let complaints: {
    getAccessibleComplaintOrThrow: jest.Mock;
    assertOrganizationWritableOrThrow: jest.Mock;
  };
  let activity: { record: jest.Mock };

  beforeEach(() => {
    prisma = {
      complaintComment: { create: jest.fn(), findMany: jest.fn() },
      $transaction: jest.fn(),
    };
    memberships = { getActiveMembership: jest.fn() };
    complaints = {
      getAccessibleComplaintOrThrow: jest.fn(),
      assertOrganizationWritableOrThrow: jest.fn().mockResolvedValue(undefined),
    };
    activity = { record: jest.fn() };

    service = new ComplaintCommentsService(
      prisma,
      memberships as unknown as MembershipsService,
      complaints as unknown as ComplaintsService,
      activity as unknown as ComplaintActivityService,
    );
  });

  function mockTx() {
    const tx = {
      complaintComment: {
        create: jest.fn().mockResolvedValue({
          id: 'comment-1',
          authorUserId: 'user-1',
          body: 'hello',
          visibility: 'PUBLIC',
          createdAt: new Date(),
        }),
      },
    };
    prisma.$transaction.mockImplementation(async (fn: any) => fn(tx));
    return tx;
  }

  describe('create', () => {
    it('a tenant can create a PUBLIC comment on their own complaint', async () => {
      complaints.getAccessibleComplaintOrThrow.mockResolvedValue(
        buildComplaint(),
      );
      mockTx();

      const result = await service.create(
        buildUser({ id: 'tenant-user-1' }),
        'complaint-1',
        {
          body: 'hello',
        },
      );
      expect(result.body).toBe('hello');
    });

    it('a tenant cannot create an INTERNAL comment', async () => {
      complaints.getAccessibleComplaintOrThrow.mockResolvedValue(
        buildComplaint(),
      );
      memberships.getActiveMembership.mockResolvedValue(null);

      await expect(
        service.create(buildUser({ id: 'tenant-user-1' }), 'complaint-1', {
          body: 'secret',
          visibility: 'INTERNAL',
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.COMPLAINT_INTERNAL_COMMENT_FORBIDDEN,
      });
    });

    it('STAFF can create an INTERNAL comment', async () => {
      complaints.getAccessibleComplaintOrThrow.mockResolvedValue(
        buildComplaint({ tenant: { userId: 'someone-else' } }),
      );
      memberships.getActiveMembership.mockResolvedValue({ role: 'STAFF' });
      const tx = mockTx();
      tx.complaintComment.create.mockResolvedValue({
        id: 'comment-2',
        authorUserId: 'user-1',
        body: 'internal note',
        visibility: 'INTERNAL',
        createdAt: new Date(),
      });

      const result = await service.create(buildUser(), 'complaint-1', {
        body: 'internal note',
        visibility: 'INTERNAL',
      });
      expect(result.visibility).toBe('INTERNAL');
    });

    it('rejects an unrelated non-member from commenting at all', async () => {
      complaints.getAccessibleComplaintOrThrow.mockResolvedValue(
        buildComplaint({ tenant: { userId: 'someone-else' } }),
      );
      memberships.getActiveMembership.mockResolvedValue(null);

      await expect(
        service.create(buildUser(), 'complaint-1', { body: 'hi' }),
      ).rejects.toMatchObject({
        code: ErrorCode.COMPLAINT_COMMENT_NOT_ALLOWED,
      });
    });
  });

  describe('findForComplaint', () => {
    it('filters out INTERNAL comments for the reporting tenant', async () => {
      complaints.getAccessibleComplaintOrThrow.mockResolvedValue(
        buildComplaint(),
      );
      prisma.complaintComment.findMany.mockResolvedValue([]);

      await service.findForComplaint(
        buildUser({ id: 'tenant-user-1' }),
        'complaint-1',
      );

      expect(prisma.complaintComment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { complaintId: 'complaint-1', visibility: 'PUBLIC' },
        }),
      );
    });

    it('shows INTERNAL comments to an organization member', async () => {
      complaints.getAccessibleComplaintOrThrow.mockResolvedValue(
        buildComplaint({ tenant: { userId: 'someone-else' } }),
      );
      prisma.complaintComment.findMany.mockResolvedValue([]);

      await service.findForComplaint(buildUser(), 'complaint-1');

      expect(prisma.complaintComment.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { complaintId: 'complaint-1', visibility: undefined },
        }),
      );
    });
  });
});
