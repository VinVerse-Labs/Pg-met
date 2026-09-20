import { AuditLogService } from './audit-log.service';

describe('AuditLogService', () => {
  let service: AuditLogService;
  let prisma: {
    auditLog: { create: jest.Mock; findMany: jest.Mock; count: jest.Mock };
  };

  beforeEach(() => {
    prisma = {
      auditLog: { create: jest.fn(), findMany: jest.fn(), count: jest.fn() },
    };
    service = new AuditLogService(prisma as any);
  });

  describe('record', () => {
    it('writes an audit entry with the given fields', async () => {
      await service.record({
        actorUserId: 'admin-1',
        action: 'ORGANIZATION_SUSPENDED',
        entityType: 'Organization',
        entityId: 'org-1',
        organizationId: 'org-1',
        metadata: { previousStatus: 'ACTIVE' },
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith({
        data: {
          actorUserId: 'admin-1',
          action: 'ORGANIZATION_SUSPENDED',
          entityType: 'Organization',
          entityId: 'org-1',
          organizationId: 'org-1',
          metadata: { previousStatus: 'ACTIVE' },
        },
      });
    });

    it('defaults organizationId to null when not provided', async () => {
      await service.record({
        actorUserId: 'admin-1',
        action: 'SAAS_PLAN_CREATED',
        entityType: 'SaasPlan',
        entityId: 'plan-1',
      });

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ organizationId: null }),
        }),
      );
    });
  });

  describe('findAll', () => {
    it('paginates and filters by action/organizationId', async () => {
      prisma.auditLog.findMany.mockResolvedValue([
        {
          id: 'log-1',
          actorUserId: 'admin-1',
          action: 'ORGANIZATION_SUSPENDED',
          entityType: 'Organization',
          entityId: 'org-1',
          organizationId: 'org-1',
          metadata: null,
          createdAt: new Date(),
        },
      ]);
      prisma.auditLog.count.mockResolvedValue(1);

      const result = await service.findAll({
        page: 1,
        limit: 20,
        action: 'ORGANIZATION_SUSPENDED',
        organizationId: 'org-1',
      });

      expect(prisma.auditLog.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: {
            action: { equals: 'ORGANIZATION_SUSPENDED' },
            organizationId: 'org-1',
          },
          skip: 0,
          take: 20,
        }),
      );
      expect(result.total).toBe(1);
      expect(result.items[0].action).toBe('ORGANIZATION_SUSPENDED');
    });
  });
});
