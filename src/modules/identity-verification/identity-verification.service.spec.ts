import { IdentityVerificationService } from './identity-verification.service';
import { ErrorCode } from '../../common/constants/error-code.enum';

describe('IdentityVerificationService', () => {
  let service: IdentityVerificationService;
  let prisma: {
    identityVerification: {
      findFirst: jest.Mock;
      findUnique: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
  };

  beforeEach(() => {
    prisma = {
      identityVerification: {
        findFirst: jest.fn(),
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    service = new IdentityVerificationService(prisma as any);
  });

  describe('start', () => {
    it('creates a new PENDING record when none exists', async () => {
      prisma.identityVerification.findFirst.mockResolvedValue(null);
      prisma.identityVerification.create.mockResolvedValue({ id: 'iv-1' });

      await service.start('user-1', 'GOVERNMENT_ID');

      expect(prisma.identityVerification.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PENDING' }),
        }),
      );
    });

    it('reuses a still-valid VERIFIED record instead of starting a new one', async () => {
      const existing = {
        id: 'iv-1',
        status: 'VERIFIED',
        expiresAt: null,
      };
      prisma.identityVerification.findFirst.mockResolvedValue(existing);

      const result = await service.start('user-1', 'GOVERNMENT_ID');

      expect(result).toBe(existing);
      expect(prisma.identityVerification.create).not.toHaveBeenCalled();
    });

    it('starts a new verification when the previous VERIFIED one has expired', async () => {
      prisma.identityVerification.findFirst.mockResolvedValue({
        id: 'iv-old',
        status: 'VERIFIED',
        expiresAt: new Date(Date.now() - 1000),
      });
      prisma.identityVerification.create.mockResolvedValue({ id: 'iv-new' });

      const result = await service.start('user-1', 'GOVERNMENT_ID');

      expect(prisma.identityVerification.create).toHaveBeenCalled();
      expect(result).toEqual({ id: 'iv-new' });
    });

    it('forces a new verification even if a valid one exists when force is set', async () => {
      prisma.identityVerification.create.mockResolvedValue({ id: 'iv-new' });

      await service.start('user-1', 'GOVERNMENT_ID', { force: true });

      expect(prisma.identityVerification.findFirst).not.toHaveBeenCalled();
      expect(prisma.identityVerification.create).toHaveBeenCalled();
    });
  });

  describe('transition', () => {
    it.each([
      ['NOT_STARTED', 'PENDING'],
      ['PENDING', 'VERIFIED'],
      ['PENDING', 'FAILED'],
      ['FAILED', 'PENDING'],
      ['VERIFIED', 'EXPIRED'],
      ['VERIFIED', 'REVOKED'],
      ['EXPIRED', 'PENDING'],
    ])('allows %s -> %s', async (from, to) => {
      prisma.identityVerification.findUnique.mockResolvedValue({
        id: 'iv-1',
        status: from,
        verifiedAt: null,
      });
      prisma.identityVerification.update.mockResolvedValue({ id: 'iv-1', status: to });

      await expect(service.transition('iv-1', to as any)).resolves.toBeDefined();
    });

    it.each([
      ['NOT_STARTED', 'VERIFIED'],
      ['VERIFIED', 'PENDING'],
      ['REVOKED', 'PENDING'],
      ['FAILED', 'VERIFIED'],
    ])('rejects %s -> %s', async (from, to) => {
      prisma.identityVerification.findUnique.mockResolvedValue({
        id: 'iv-1',
        status: from,
        verifiedAt: null,
      });

      await expect(
        service.transition('iv-1', to as any),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_STATE_TRANSITION });
      expect(prisma.identityVerification.update).not.toHaveBeenCalled();
    });

    it('sets verifiedAt when transitioning into VERIFIED', async () => {
      prisma.identityVerification.findUnique.mockResolvedValue({
        id: 'iv-1',
        status: 'PENDING',
        verifiedAt: null,
      });
      prisma.identityVerification.update.mockResolvedValue({});

      await service.transition('iv-1', 'VERIFIED' as any);

      expect(prisma.identityVerification.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ verifiedAt: expect.any(Date) }),
        }),
      );
    });

    it('throws NOT_FOUND for an unknown record', async () => {
      prisma.identityVerification.findUnique.mockResolvedValue(null);

      await expect(
        service.transition('missing', 'PENDING' as any),
      ).rejects.toMatchObject({ code: ErrorCode.NOT_FOUND });
    });
  });
});
