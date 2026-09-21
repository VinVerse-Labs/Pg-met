import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { ComplaintsService } from './complaints.service';
import { ComplaintAttachmentsService } from './complaint-attachments.service';

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

describe('ComplaintAttachmentsService', () => {
  let service: ComplaintAttachmentsService;
  let prisma: any;
  let memberships: { getActiveMembership: jest.Mock };
  let complaints: {
    getAccessibleComplaintOrThrow: jest.Mock;
    assertOrganizationWritableOrThrow: jest.Mock;
  };

  beforeEach(() => {
    prisma = {
      complaintAttachment: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        delete: jest.fn(),
      },
    };
    memberships = { getActiveMembership: jest.fn() };
    complaints = {
      getAccessibleComplaintOrThrow: jest.fn().mockResolvedValue({
        id: 'complaint-1',
        organizationId: 'org-1',
      }),
      assertOrganizationWritableOrThrow: jest.fn().mockResolvedValue(undefined),
    };

    service = new ComplaintAttachmentsService(
      prisma,
      memberships as unknown as MembershipsService,
      complaints as unknown as ComplaintsService,
    );
  });

  describe('create', () => {
    it('accepts an allowed MIME type within the size limit', async () => {
      prisma.complaintAttachment.create.mockResolvedValue({
        id: 'att-1',
        uploadedByUserId: 'user-1',
        url: 'https://example.com/x.jpg',
        fileName: 'x.jpg',
        mimeType: 'image/jpeg',
        size: 1000,
        createdAt: new Date(),
      });

      const result = await service.create(buildUser(), 'complaint-1', {
        url: 'https://example.com/x.jpg',
        fileName: 'x.jpg',
        mimeType: 'image/jpeg',
        size: 1000,
      });
      expect(result.id).toBe('att-1');
    });

    it('rejects a disallowed MIME type', async () => {
      await expect(
        service.create(buildUser(), 'complaint-1', {
          url: 'https://example.com/x.exe',
          fileName: 'x.exe',
          mimeType: 'application/x-msdownload',
          size: 1000,
        } as any),
      ).rejects.toMatchObject({
        code: ErrorCode.COMPLAINT_ATTACHMENT_NOT_ALLOWED,
      });
    });

    it('rejects a file over the size limit', async () => {
      await expect(
        service.create(buildUser(), 'complaint-1', {
          url: 'https://example.com/x.jpg',
          fileName: 'x.jpg',
          mimeType: 'image/jpeg',
          size: 11 * 1024 * 1024,
        }),
      ).rejects.toMatchObject({
        code: ErrorCode.COMPLAINT_ATTACHMENT_NOT_ALLOWED,
      });
    });
  });

  describe('remove', () => {
    it('allows the uploader to delete their own attachment', async () => {
      prisma.complaintAttachment.findFirst.mockResolvedValue({
        id: 'att-1',
        uploadedByUserId: 'user-1',
      });

      await service.remove(buildUser(), 'complaint-1', 'att-1');
      expect(prisma.complaintAttachment.delete).toHaveBeenCalledWith({
        where: { id: 'att-1' },
      });
    });

    it('allows OWNER/MANAGER to delete another user’s attachment', async () => {
      prisma.complaintAttachment.findFirst.mockResolvedValue({
        id: 'att-1',
        uploadedByUserId: 'someone-else',
      });
      memberships.getActiveMembership.mockResolvedValue({ role: 'OWNER' });

      await service.remove(buildUser(), 'complaint-1', 'att-1');
      expect(prisma.complaintAttachment.delete).toHaveBeenCalled();
    });

    it('rejects a different tenant deleting another user’s attachment', async () => {
      prisma.complaintAttachment.findFirst.mockResolvedValue({
        id: 'att-1',
        uploadedByUserId: 'someone-else',
      });
      memberships.getActiveMembership.mockResolvedValue(null);

      await expect(
        service.remove(buildUser(), 'complaint-1', 'att-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.COMPLAINT_ATTACHMENT_NOT_ALLOWED,
      });
      expect(prisma.complaintAttachment.delete).not.toHaveBeenCalled();
    });
  });
});
