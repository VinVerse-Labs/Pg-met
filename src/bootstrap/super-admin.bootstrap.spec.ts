import { INestApplication } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { promoteSuperAdminIfConfigured } from './super-admin.bootstrap';

function buildApp(
  configValue: { superAdminEmail: string | null },
  prisma: { user: { findUnique: jest.Mock; update: jest.Mock } },
): INestApplication {
  return {
    get: (token: unknown) => {
      if (token === ConfigService) {
        return { get: jest.fn().mockReturnValue(configValue) };
      }
      if (token === PrismaService) {
        return prisma;
      }
      throw new Error(
        `Unexpected token requested from app.get: ${String(token)}`,
      );
    },
  } as unknown as INestApplication;
}

describe('promoteSuperAdminIfConfigured', () => {
  it('does nothing when SUPER_ADMIN_EMAIL is not configured', async () => {
    const prisma = { user: { findUnique: jest.fn(), update: jest.fn() } };
    const app = buildApp({ superAdminEmail: null }, prisma);

    await promoteSuperAdminIfConfigured(app);

    expect(prisma.user.findUnique).not.toHaveBeenCalled();
    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('promotes a matching, not-yet-admin user', async () => {
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', platformRole: 'USER' }),
        update: jest.fn(),
      },
    };
    const app = buildApp({ superAdminEmail: 'founder@example.com' }, prisma);

    await promoteSuperAdminIfConfigured(app);

    expect(prisma.user.update).toHaveBeenCalledWith({
      where: { id: 'user-1' },
      data: { platformRole: 'SUPER_ADMIN' },
    });
  });

  it('is idempotent - never re-promotes an already-SUPER_ADMIN user', async () => {
    const prisma = {
      user: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ id: 'user-1', platformRole: 'SUPER_ADMIN' }),
        update: jest.fn(),
      },
    };
    const app = buildApp({ superAdminEmail: 'founder@example.com' }, prisma);

    await promoteSuperAdminIfConfigured(app);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });

  it('does nothing (and never creates a user) when no matching user has registered', async () => {
    const prisma = {
      user: {
        findUnique: jest.fn().mockResolvedValue(null),
        update: jest.fn(),
      },
    };
    const app = buildApp({ superAdminEmail: 'nobody@example.com' }, prisma);

    await promoteSuperAdminIfConfigured(app);

    expect(prisma.user.update).not.toHaveBeenCalled();
  });
});
