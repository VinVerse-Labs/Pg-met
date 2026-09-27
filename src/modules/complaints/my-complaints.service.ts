import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import {
  PaginatedResult,
  paginationSkipTake,
} from '../../common/dto/pagination-query.dto';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ComplaintCommentsService } from './complaint-comments.service';
import { ComplaintLifecycleService } from './complaint-lifecycle.service';
import { ListMyComplaintsQueryDto } from './dto/list-my-complaints.query.dto';
import {
  MyComplaintActivityResponseDto,
  MyComplaintCommentResponseDto,
  MyComplaintResponseDto,
} from './dto/my-complaint-response.dto';

// The tenant's own complaints, and nothing else (Tenant Web). Unlike
// GET /complaints - which widens to organization complaints as soon as the
// caller holds any membership - every query here is pinned to the caller's
// own tenant profile: Authenticated User -> Tenant -> Complaint. A user who
// is both a tenant and an owner/manager therefore sees exactly their own
// complaints here, and a complaint id belonging to anyone else is a 404
// (same "no existence leak" convention as ComplaintsService.notFound).
//
// Writes reuse the existing services (comments, cancel) after the
// ownership check, so the lifecycle/visibility rules stay in one place.
@Injectable()
export class MyComplaintsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly comments: ComplaintCommentsService,
    private readonly lifecycle: ComplaintLifecycleService,
  ) {}

  async list(
    user: AuthenticatedUser,
    query: ListMyComplaintsQueryDto,
  ): Promise<PaginatedResult<MyComplaintResponseDto>> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const tenantId = await this.findCallerTenantId(user);
    if (!tenantId) {
      return { items: [], total: 0, page, limit };
    }
    const { skip, take } = paginationSkipTake(query);
    const where: Prisma.ComplaintWhereInput = {
      tenantId,
      status: query.status,
    };
    const [rows, total] = await Promise.all([
      this.prisma.complaint.findMany({
        where,
        include: { property: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.complaint.count({ where }),
    ]);
    return {
      items: rows.map((row) => MyComplaintResponseDto.fromEntity(row)),
      total,
      page,
      limit,
    };
  }

  async findOne(
    user: AuthenticatedUser,
    complaintId: string,
  ): Promise<MyComplaintResponseDto> {
    return MyComplaintResponseDto.fromEntity(
      await this.getOwnComplaintOrThrow(user, complaintId),
    );
  }

  async findComments(
    user: AuthenticatedUser,
    complaintId: string,
  ): Promise<MyComplaintCommentResponseDto[]> {
    await this.getOwnComplaintOrThrow(user, complaintId);
    const rows = await this.prisma.complaintComment.findMany({
      where: { complaintId, visibility: 'PUBLIC' },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) =>
      MyComplaintCommentResponseDto.fromEntity(row, user.id),
    );
  }

  async addComment(
    user: AuthenticatedUser,
    complaintId: string,
    body: string,
  ): Promise<MyComplaintCommentResponseDto> {
    await this.getOwnComplaintOrThrow(user, complaintId);
    // Always PUBLIC from the tenant surface, whatever else the caller is.
    const created = await this.comments.create(user, complaintId, {
      body,
      visibility: 'PUBLIC',
    });
    const dto = new MyComplaintCommentResponseDto();
    dto.id = created.id;
    dto.author = 'YOU';
    dto.body = created.body;
    dto.createdAt = created.createdAt;
    return dto;
  }

  async findActivity(
    user: AuthenticatedUser,
    complaintId: string,
  ): Promise<MyComplaintActivityResponseDto[]> {
    await this.getOwnComplaintOrThrow(user, complaintId);
    const rows = await this.prisma.complaintActivity.findMany({
      where: { complaintId },
      orderBy: { createdAt: 'asc' },
    });
    return rows.map((row) =>
      MyComplaintActivityResponseDto.fromEntity(row, user.id),
    );
  }

  async cancel(
    user: AuthenticatedUser,
    complaintId: string,
  ): Promise<MyComplaintResponseDto> {
    await this.getOwnComplaintOrThrow(user, complaintId);
    await this.lifecycle.cancel(user, complaintId);
    return this.findOne(user, complaintId);
  }

  private async findCallerTenantId(
    user: AuthenticatedUser,
  ): Promise<string | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    return tenant?.id ?? null;
  }

  private async getOwnComplaintOrThrow(
    user: AuthenticatedUser,
    complaintId: string,
  ) {
    const tenantId = await this.findCallerTenantId(user);
    const complaint = tenantId
      ? await this.prisma.complaint.findFirst({
          where: { id: complaintId, tenantId },
          include: { property: { select: { name: true } } },
        })
      : null;
    if (!complaint) {
      throw new AppException(
        ErrorCode.COMPLAINT_NOT_FOUND,
        'Complaint not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return complaint;
  }
}
