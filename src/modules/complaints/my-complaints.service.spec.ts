import { MyComplaintsService } from './my-complaints.service';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

const alice = { id: 'user-alice', platformRole: 'USER' } as AuthenticatedUser;
const dualRole = { id: 'user-dual', platformRole: 'USER' } as AuthenticatedUser;

function complaintRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'c-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    residencyId: 'res-1',
    tenantId: 'tenant-alice',
    roomId: null,
    bedId: null,
    reportedByUserId: 'user-alice',
    assignedToUserId: 'staff-7',
    category: 'PLUMBING',
    priority: 'MEDIUM',
    status: 'OPEN',
    title: 'Leaking tap',
    description: 'Bathroom tap leaks',
    resolutionNote: null,
    resolvedAt: null,
    closedAt: null,
    createdAt: new Date('2026-09-20T10:00:00Z'),
    updatedAt: new Date('2026-09-20T10:00:00Z'),
    property: { name: 'Sunrise PG' },
    ...overrides,
  };
}

describe('MyComplaintsService', () => {
  let prisma: any;
  let comments: any;
  let lifecycle: any;
  let service: MyComplaintsService;

  beforeEach(() => {
    prisma = {
      tenant: {
        findUnique: jest.fn(({ where }) =>
          Promise.resolve(
            where.userId === 'user-alice'
              ? { id: 'tenant-alice' }
              : where.userId === 'user-dual'
                ? { id: 'tenant-dual' }
                : null,
          ),
        ),
      },
      complaint: {
        findMany: jest.fn().mockResolvedValue([complaintRow()]),
        count: jest.fn().mockResolvedValue(1),
        findFirst: jest.fn(),
      },
      complaintComment: { findMany: jest.fn() },
      complaintActivity: { findMany: jest.fn() },
    };
    comments = { create: jest.fn() };
    lifecycle = { cancel: jest.fn() };
    service = new MyComplaintsService(prisma, comments, lifecycle);
  });

  it('lists only the caller’s own tenant complaints, even for an org member', async () => {
    await service.list(dualRole, { page: 1, limit: 20 });
    const where = prisma.complaint.findMany.mock.calls[0][0].where;
    expect(where).toEqual({ tenantId: 'tenant-dual', status: undefined });
    expect(where.organizationId).toBeUndefined();
  });

  it('returns an empty page (no query) for a user without a tenant profile', async () => {
    const result = await service.list(
      { id: 'user-nobody', platformRole: 'USER' } as AuthenticatedUser,
      { page: 1, limit: 20 },
    );
    expect(result).toEqual({ items: [], total: 0, page: 1, limit: 20 });
    expect(prisma.complaint.findMany).not.toHaveBeenCalled();
  });

  it('never exposes assignee identity or org/tenant ids', async () => {
    const { items } = await service.list(alice, { page: 1, limit: 20 });
    expect(items[0]).toMatchObject({
      isAssigned: true,
      propertyName: 'Sunrise PG',
    });
    expect(items[0]).not.toHaveProperty('assignedToUserId');
    expect(items[0]).not.toHaveProperty('organizationId');
    expect(items[0]).not.toHaveProperty('tenantId');
  });

  it('404s another tenant’s complaint id (lookup is pinned to the caller’s tenant)', async () => {
    prisma.complaint.findFirst.mockResolvedValue(null);
    await expect(service.findOne(alice, 'c-bob')).rejects.toMatchObject({
      code: ErrorCode.COMPLAINT_NOT_FOUND,
    });
    expect(prisma.complaint.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: 'c-bob', tenantId: 'tenant-alice' },
      }),
    );
  });

  it('returns PUBLIC comments only, labelled YOU / PROPERTY_TEAM', async () => {
    prisma.complaint.findFirst.mockResolvedValue(complaintRow());
    prisma.complaintComment.findMany.mockResolvedValue([
      {
        id: 'k1',
        authorUserId: 'user-alice',
        body: 'Still leaking',
        visibility: 'PUBLIC',
        createdAt: new Date(),
      },
      {
        id: 'k2',
        authorUserId: 'staff-7',
        body: 'Plumber booked',
        visibility: 'PUBLIC',
        createdAt: new Date(),
      },
    ]);
    const result = await service.findComments(alice, 'c-1');
    expect(prisma.complaintComment.findMany.mock.calls[0][0].where).toEqual({
      complaintId: 'c-1',
      visibility: 'PUBLIC',
    });
    expect(result.map((c) => c.author)).toEqual(['YOU', 'PROPERTY_TEAM']);
    expect(result[0]).not.toHaveProperty('authorUserId');
  });

  it('adds comments as PUBLIC only, after the ownership check', async () => {
    prisma.complaint.findFirst.mockResolvedValue(complaintRow());
    comments.create.mockResolvedValue({
      id: 'k3',
      authorUserId: 'user-alice',
      body: 'Thanks',
      visibility: 'PUBLIC',
      createdAt: new Date(),
    });
    const result = await service.addComment(alice, 'c-1', 'Thanks');
    expect(comments.create).toHaveBeenCalledWith(alice, 'c-1', {
      body: 'Thanks',
      visibility: 'PUBLIC',
    });
    expect(result.author).toBe('YOU');
  });

  it('does not reach the comment/cancel services for someone else’s complaint', async () => {
    prisma.complaint.findFirst.mockResolvedValue(null);
    await expect(service.addComment(alice, 'c-bob', 'x')).rejects.toMatchObject(
      { code: ErrorCode.COMPLAINT_NOT_FOUND },
    );
    await expect(service.cancel(alice, 'c-bob')).rejects.toMatchObject({
      code: ErrorCode.COMPLAINT_NOT_FOUND,
    });
    expect(comments.create).not.toHaveBeenCalled();
    expect(lifecycle.cancel).not.toHaveBeenCalled();
  });

  it('labels activity actors without exposing user ids', async () => {
    prisma.complaint.findFirst.mockResolvedValue(complaintRow());
    prisma.complaintActivity.findMany.mockResolvedValue([
      {
        id: 'a1',
        actorUserId: 'user-alice',
        type: 'CREATED',
        oldStatus: null,
        newStatus: 'OPEN',
        oldAssigneeId: null,
        newAssigneeId: null,
        createdAt: new Date(),
      },
      {
        id: 'a2',
        actorUserId: 'staff-7',
        type: 'ASSIGNED',
        oldStatus: 'OPEN',
        newStatus: 'ASSIGNED',
        oldAssigneeId: null,
        newAssigneeId: 'staff-7',
        createdAt: new Date(),
      },
    ]);
    const result = await service.findActivity(alice, 'c-1');
    expect(result.map((a) => a.actor)).toEqual(['YOU', 'PROPERTY_TEAM']);
    expect(result[1]).not.toHaveProperty('newAssigneeId');
    expect(result[1]).not.toHaveProperty('actorUserId');
  });
});
