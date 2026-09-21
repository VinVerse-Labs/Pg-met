import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

export interface RecordApplicationActivityInput {
  applicationId: string;
  actorUserId?: string | null;
  action: string;
  metadata?: Record<string, unknown>;
}

// The one place an ApplicationActivity row is ever created - always
// called from inside the same transaction as the mutation it describes
// (the same discipline ComplaintActivityService already established), so
// this permanent business-history trail can never drift from what
// actually happened. Deliberately separate from AuditLog (Phase 8's
// platform-admin trail, a different reader) - see TenantApplicationsService
// docs for which events are written to both.
@Injectable()
export class ApplicationActivityService {
  constructor(private readonly prisma: PrismaService) {}

  async record(
    tx: Prisma.TransactionClient,
    input: RecordApplicationActivityInput,
  ): Promise<void> {
    await tx.applicationActivity.create({
      data: {
        applicationId: input.applicationId,
        actorUserId: input.actorUserId ?? null,
        action: input.action,
        metadata: (input.metadata ?? undefined) as never,
      },
    });
  }

  async findForApplication(applicationId: string) {
    return this.prisma.applicationActivity.findMany({
      where: { applicationId },
      orderBy: { createdAt: 'asc' },
    });
  }
}
