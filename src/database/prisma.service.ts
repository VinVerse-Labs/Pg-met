import {
  INestApplication,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

// Thin wrapper around PrismaClient so it participates in Nest's lifecycle
// (connect on startup, disconnect on shutdown) and can be dependency-
// injected like any other provider. Every module talks to the database
// exclusively through this service - no module should instantiate its own
// PrismaClient.
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Connected to the database.');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }

  // Ensures Prisma disconnects before Nest's own shutdown hooks finish,
  // so a SIGTERM (container restart/redeploy) does not leave the process
  // holding open connections while the pool is torn down elsewhere.
  async enableShutdownHooks(app: INestApplication): Promise<void> {
    process.once('beforeExit', () => {
      void app.close();
    });
  }
}
