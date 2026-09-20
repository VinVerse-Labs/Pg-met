import { INestApplication, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PlatformAdminConfig } from '../config/configuration';
import { PrismaService } from '../database/prisma.service';

const logger = new Logger('SuperAdminBootstrap');

// The only mechanism that ever grants PlatformRole.SUPER_ADMIN (spec:
// "do NOT create a public API such as POST /super-admin/register... Super
// Admin creation should be controlled through a secure administrative/
// bootstrap mechanism"). Runs once per boot, is idempotent (safe to run
// on every deploy), and only ever *promotes* an already-registered user -
// it never creates one, never accepts a password, and never logs the
// email/user id at more than info level (no secrets exist here to leak).
export async function promoteSuperAdminIfConfigured(
  app: INestApplication,
): Promise<void> {
  const configService = app.get(ConfigService);
  const superAdminEmail =
    configService.get<PlatformAdminConfig>('platformAdmin')?.superAdminEmail;
  if (!superAdminEmail) {
    return;
  }

  const prisma = app.get(PrismaService);
  const user = await prisma.user.findUnique({
    where: { email: superAdminEmail },
  });
  if (!user) {
    logger.warn(
      'SUPER_ADMIN_EMAIL is set but no matching user has registered yet - nothing to promote.',
    );
    return;
  }
  if (user.platformRole === 'SUPER_ADMIN') {
    return;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { platformRole: 'SUPER_ADMIN' },
  });
  logger.log(`PLATFORM_ROLE_PROMOTED user=${user.id} role=SUPER_ADMIN`);
}
