import { HttpStatus } from '@nestjs/common';
import { User, UserStatus } from '@prisma/client';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { AuthService } from './auth.service';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';
import { UsersService } from '../../users/users.service';

function buildUser(overrides: Partial<User> = {}): User {
  return {
    id: 'user-1',
    name: 'Rahul',
    email: 'rahul@example.com',
    phone: null,
    passwordHash: 'hashed-password',
    platformRole: 'USER',
    status: 'ACTIVE' as UserStatus,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('AuthService', () => {
  let authService: AuthService;
  let prisma: {
    refreshToken: {
      create: jest.Mock;
      findUnique: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let usersService: {
    create: jest.Mock;
    findByIdentifier: jest.Mock;
    findById: jest.Mock;
  };
  let passwordService: { hash: jest.Mock; verify: jest.Mock };
  let tokenService: {
    signAccessToken: jest.Mock;
    signRefreshToken: jest.Mock;
    verifyRefreshToken: jest.Mock;
    hashToken: jest.Mock;
  };

  const meta = { userAgent: 'jest', ipAddress: '127.0.0.1' };

  beforeEach(() => {
    prisma = {
      refreshToken: {
        create: jest.fn(),
        findUnique: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };
    usersService = {
      create: jest.fn(),
      findByIdentifier: jest.fn(),
      findById: jest.fn(),
    };
    passwordService = { hash: jest.fn(), verify: jest.fn() };
    tokenService = {
      signAccessToken: jest.fn(),
      signRefreshToken: jest.fn(),
      verifyRefreshToken: jest.fn(),
      hashToken: jest.fn(),
    };

    authService = new AuthService(
      prisma as any,
      usersService as unknown as UsersService,
      passwordService as unknown as PasswordService,
      tokenService as unknown as TokenService,
    );

    tokenService.signAccessToken.mockReturnValue({
      token: 'access-token',
      expiresIn: 900,
    });
    tokenService.signRefreshToken.mockReturnValue({
      token: 'refresh-token',
      jti: 'jti-1',
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    });
    tokenService.hashToken.mockImplementation(
      (token: string) => `hash(${token})`,
    );
  });

  describe('register', () => {
    it('rejects registration with neither email nor phone', async () => {
      await expect(
        authService.register(
          { name: 'Rahul', password: 'password123' } as any,
          meta,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.VALIDATION_FAILED });
      expect(usersService.create).not.toHaveBeenCalled();
    });

    it('creates a user and issues tokens on success', async () => {
      passwordService.hash.mockResolvedValue('hashed');
      usersService.create.mockResolvedValue(buildUser());
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await authService.register(
        {
          name: 'Rahul',
          email: 'rahul@example.com',
          password: 'password123',
        } as any,
        meta,
      );

      expect(usersService.create).toHaveBeenCalledWith(
        expect.objectContaining({ passwordHash: 'hashed' }),
      );
      expect(result.user).not.toHaveProperty('passwordHash');
      expect(result.tokens.accessToken).toBe('access-token');
      expect(result.tokens.refreshToken).toBe('refresh-token');
    });
  });

  describe('login', () => {
    it('throws a generic INVALID_CREDENTIALS when the account does not exist', async () => {
      usersService.findByIdentifier.mockResolvedValue(null);

      await expect(
        authService.login(
          { identifier: 'ghost@example.com', password: 'x' },
          meta,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.INVALID_CREDENTIALS,
        status: HttpStatus.UNAUTHORIZED,
      });
    });

    it('throws the same generic INVALID_CREDENTIALS on a wrong password', async () => {
      usersService.findByIdentifier.mockResolvedValue(buildUser());
      passwordService.verify.mockResolvedValue(false);

      await expect(
        authService.login(
          { identifier: 'rahul@example.com', password: 'wrong' },
          meta,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.INVALID_CREDENTIALS });
    });

    it('rejects a suspended user even with the correct password', async () => {
      usersService.findByIdentifier.mockResolvedValue(
        buildUser({ status: 'SUSPENDED' as UserStatus }),
      );
      passwordService.verify.mockResolvedValue(true);

      await expect(
        authService.login(
          { identifier: 'rahul@example.com', password: 'password123' },
          meta,
        ),
      ).rejects.toMatchObject({
        code: ErrorCode.ACCOUNT_SUSPENDED,
        status: HttpStatus.FORBIDDEN,
      });
    });

    it('rejects an inactive user even with the correct password', async () => {
      usersService.findByIdentifier.mockResolvedValue(
        buildUser({ status: 'INACTIVE' as UserStatus }),
      );
      passwordService.verify.mockResolvedValue(true);

      await expect(
        authService.login(
          { identifier: 'rahul@example.com', password: 'password123' },
          meta,
        ),
      ).rejects.toMatchObject({ code: ErrorCode.ACCOUNT_INACTIVE });
    });

    it('issues tokens and never returns the password hash on success', async () => {
      usersService.findByIdentifier.mockResolvedValue(buildUser());
      passwordService.verify.mockResolvedValue(true);
      prisma.refreshToken.create.mockResolvedValue({});

      const result = await authService.login(
        { identifier: 'rahul@example.com', password: 'password123' },
        meta,
      );

      expect(result.tokens.accessToken).toBe('access-token');
      expect(JSON.stringify(result)).not.toContain('hashed-password');
    });
  });

  describe('refresh', () => {
    const activeRow = {
      id: 'row-1',
      userId: 'user-1',
      tokenHash: 'hash(refresh-token)',
      revokedAt: null,
      expiresAt: new Date(Date.now() + 1000 * 60 * 60),
    };

    beforeEach(() => {
      tokenService.verifyRefreshToken.mockResolvedValue({
        sub: 'user-1',
        jti: 'jti-1',
      });
    });

    it('rotates a valid refresh token and revokes the old one', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(activeRow);
      usersService.findById.mockResolvedValue(buildUser());
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          refreshToken: {
            updateMany: jest.fn().mockResolvedValue({ count: 1 }),
            create: jest.fn().mockResolvedValue({}),
          },
        };
        return fn(tx);
      });
      tokenService.signRefreshToken.mockReturnValue({
        token: 'new-refresh-token',
        jti: 'jti-2',
        expiresAt: new Date(Date.now() + 1000 * 60 * 60),
      });

      const result = await authService.refresh(
        { refreshToken: 'refresh-token' },
        meta,
      );

      expect(result.refreshToken).toBe('new-refresh-token');
      expect(result.accessToken).toBe('access-token');
    });

    it('rejects and revokes every session when a revoked (reused) token is presented', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...activeRow,
        revokedAt: new Date(),
      });

      await expect(
        authService.refresh({ refreshToken: 'refresh-token' }, meta),
      ).rejects.toMatchObject({ code: ErrorCode.TOKEN_REVOKED });

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', revokedAt: null },
        }),
      );
    });

    it('rejects an expired refresh token row', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue({
        ...activeRow,
        expiresAt: new Date(Date.now() - 1000),
      });

      await expect(
        authService.refresh({ refreshToken: 'refresh-token' }, meta),
      ).rejects.toMatchObject({ code: ErrorCode.TOKEN_EXPIRED });
    });

    it('rejects a malformed/foreign refresh token JWT', async () => {
      tokenService.verifyRefreshToken.mockRejectedValue(
        Object.assign(new Error('bad token'), { name: 'JsonWebTokenError' }),
      );

      await expect(
        authService.refresh({ refreshToken: 'garbage' }, meta),
      ).rejects.toMatchObject({ code: ErrorCode.TOKEN_INVALID });
    });

    it('rejects an expired refresh token JWT distinctly from an invalid one', async () => {
      tokenService.verifyRefreshToken.mockRejectedValue(
        Object.assign(new Error('expired'), { name: 'TokenExpiredError' }),
      );

      await expect(
        authService.refresh({ refreshToken: 'expired' }, meta),
      ).rejects.toMatchObject({ code: ErrorCode.TOKEN_EXPIRED });
    });

    it('treats a lost compare-and-swap race as reuse (concurrent refresh)', async () => {
      prisma.refreshToken.findUnique.mockResolvedValue(activeRow);
      usersService.findById.mockResolvedValue(buildUser());
      prisma.$transaction.mockImplementation(async (fn: any) => {
        const tx = {
          refreshToken: {
            // Another concurrent request already revoked this row.
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            create: jest.fn(),
          },
        };
        return fn(tx);
      });

      await expect(
        authService.refresh({ refreshToken: 'refresh-token' }, meta),
      ).rejects.toMatchObject({ code: ErrorCode.TOKEN_REVOKED });
    });
  });

  describe('logout', () => {
    it('revokes the matching session', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 1 });

      await authService.logout({ refreshToken: 'refresh-token' });

      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { tokenHash: 'hash(refresh-token)', revokedAt: null },
        data: { revokedAt: expect.any(Date) },
      });
    });

    it('does not throw for an already-revoked/unknown token (idempotent)', async () => {
      prisma.refreshToken.updateMany.mockResolvedValue({ count: 0 });

      await expect(
        authService.logout({ refreshToken: 'unknown' }),
      ).resolves.toBeUndefined();
    });
  });

  it('never lets an AppException carry a passwordHash in its details', async () => {
    usersService.findByIdentifier.mockResolvedValue(buildUser());
    passwordService.verify.mockResolvedValue(false);

    try {
      await authService.login(
        { identifier: 'rahul@example.com', password: 'x' },
        meta,
      );
      fail('expected login to throw');
    } catch (error) {
      expect(error).toBeInstanceOf(AppException);
      expect(
        JSON.stringify((error as AppException).details ?? ''),
      ).not.toContain('hashed-password');
    }
  });
});
