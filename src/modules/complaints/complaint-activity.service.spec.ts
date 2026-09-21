import { ComplaintActivityService } from './complaint-activity.service';

describe('ComplaintActivityService', () => {
  let service: ComplaintActivityService;
  let prisma: { complaintActivity: { findMany: jest.Mock } };

  beforeEach(() => {
    prisma = { complaintActivity: { findMany: jest.fn() } };
    service = new ComplaintActivityService(prisma as any);
  });

  describe('record', () => {
    it('writes an activity row via the given transaction client, never the outer prisma instance', async () => {
      const tx = { complaintActivity: { create: jest.fn() } };
      await service.record(tx as any, {
        complaintId: 'c1',
        actorUserId: 'user-1',
        type: 'CREATED',
        newStatus: 'OPEN',
      });
      expect(tx.complaintActivity.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ complaintId: 'c1', type: 'CREATED' }),
        }),
      );
    });
  });

  describe('findForComplaint', () => {
    it('returns activity ordered oldest first', async () => {
      prisma.complaintActivity.findMany.mockResolvedValue([]);
      await service.findForComplaint('c1');
      expect(prisma.complaintActivity.findMany).toHaveBeenCalledWith({
        where: { complaintId: 'c1' },
        orderBy: { createdAt: 'asc' },
      });
    });
  });
});
