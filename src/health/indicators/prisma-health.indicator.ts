import { Injectable } from '@nestjs/common';
import {
  HealthCheckError,
  HealthIndicator,
  HealthIndicatorResult,
} from '@nestjs/terminus';
import { PrismaService } from '../../database/prisma.service';

// A minimal, Postgres-specific health indicator. Terminus ships its own
// PrismaHealthIndicator, but it is built around a Mongo-vs-SQL detection
// dance ($runCommandRaw first, $queryRawUnsafe only as a fallback) that
// this project - Postgres-only - will never need, and that makes the
// happy path harder to unit test than a single `SELECT 1`.
@Injectable()
export class PrismaHealthIndicator extends HealthIndicator {
  constructor(private readonly prisma: PrismaService) {
    super();
  }

  async pingCheck(key: string): Promise<HealthIndicatorResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return this.getStatus(key, true);
    } catch (error) {
      // Terminus's executor only treats a *thrown* HealthCheckError as a
      // failure - a normally-returned "down" result is otherwise folded
      // into `info` and the overall check still reports 'ok'.
      const message =
        error instanceof Error ? error.message : 'Unknown database error';
      throw new HealthCheckError(
        message,
        this.getStatus(key, false, { message }),
      );
    }
  }
}
