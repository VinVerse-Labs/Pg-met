import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import {
  PaginatedResult,
  PaginationQueryDto,
  paginationSkipTake,
} from '../../common/dto/pagination-query.dto';
import { AuditLogResponseDto } from './dto/audit-log-response.dto';

export interface RecordAuditEventInput {
  actorUserId: string;
  action: string;
  entityType: string;
  entityId: string;
  organizationId?: string | null;
  // Never put a secret/password/token/raw payment credential in here -
  // this is written to a durable, admin-readable table (spec: "do not
  // store passwords, secrets, or sensitive payment credentials in audit
  // logs"). Only small, already-non-sensitive facts about the action
  // (e.g. a plan's new price, a previous/next status) belong here.
  metadata?: Record<string, unknown>;
}

// The single place every Phase 8 sensitive admin action is recorded
// (spec: "implement a minimal reusable platform audit log rather than
// scattering logs across controllers"). Deliberately just an
// append-only writer + a paginated reader - there is no update/delete,
// since an audit trail that could be edited after the fact would not be
// one.
@Injectable()
export class AuditLogService {
  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordAuditEventInput): Promise<void> {
    await this.prisma.auditLog.create({
      data: {
        actorUserId: input.actorUserId,
        action: input.action,
        entityType: input.entityType,
        entityId: input.entityId,
        organizationId: input.organizationId ?? null,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue,
      },
    });
  }

  async findAll(
    query: PaginationQueryDto & { action?: string; organizationId?: string },
  ): Promise<PaginatedResult<AuditLogResponseDto>> {
    const { skip, take } = paginationSkipTake(query);
    const where: Prisma.AuditLogWhereInput = {
      action: query.action ? { equals: query.action } : undefined,
      organizationId: query.organizationId ?? undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.auditLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.auditLog.count({ where }),
    ]);
    return {
      items: rows.map(AuditLogResponseDto.fromEntity),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }
}
