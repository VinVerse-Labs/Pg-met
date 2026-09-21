import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ComplaintsService } from './complaints.service';
import { ComplaintActivityService } from './complaint-activity.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ComplaintCommentResponseDto } from './dto/complaint-comment-response.dto';

// PUBLIC/INTERNAL visibility (spec: "tenant must never see INTERNAL
// comments... do not expose internal notes through a generic complaint
// response without filtering") is enforced entirely here, on the read
// path - never left to the client, and never mixed into
// ComplaintResponseDto itself.
@Injectable()
export class ComplaintCommentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly complaints: ComplaintsService,
    private readonly activity: ComplaintActivityService,
  ) {}

  async create(
    user: AuthenticatedUser,
    complaintId: string,
    dto: CreateCommentDto,
  ): Promise<ComplaintCommentResponseDto> {
    const complaint = await this.complaints.getAccessibleComplaintOrThrow(
      user,
      complaintId,
    );
    const isTenant = complaint.tenant.userId === user.id;

    const visibility = dto.visibility ?? 'PUBLIC';
    if (visibility === 'INTERNAL') {
      if (user.platformRole !== 'SUPER_ADMIN') {
        const membership = await this.memberships.getActiveMembership(
          user.id,
          complaint.organizationId,
        );
        if (!membership) {
          throw new AppException(
            ErrorCode.COMPLAINT_INTERNAL_COMMENT_FORBIDDEN,
            'Only OWNER/MANAGER/STAFF may create an internal comment.',
            HttpStatus.FORBIDDEN,
          );
        }
      }
    } else if (!isTenant && user.platformRole !== 'SUPER_ADMIN') {
      const membership = await this.memberships.getActiveMembership(
        user.id,
        complaint.organizationId,
      );
      if (!membership) {
        throw new AppException(
          ErrorCode.COMPLAINT_COMMENT_NOT_ALLOWED,
          'You are not allowed to comment on this complaint.',
          HttpStatus.FORBIDDEN,
        );
      }
    }

    if (user.platformRole !== 'SUPER_ADMIN') {
      await this.complaints.assertOrganizationWritableOrThrow(
        complaint.organizationId,
      );
    }

    const comment = await this.prisma.$transaction(async (tx) => {
      const created = await tx.complaintComment.create({
        data: {
          complaintId,
          authorUserId: user.id,
          body: dto.body,
          visibility,
        },
      });
      await this.activity.record(tx, {
        complaintId,
        actorUserId: user.id,
        type: 'COMMENT_ADDED',
      });
      return created;
    });

    return ComplaintCommentResponseDto.fromEntity(comment);
  }

  async findForComplaint(
    user: AuthenticatedUser,
    complaintId: string,
  ): Promise<ComplaintCommentResponseDto[]> {
    const complaint = await this.complaints.getAccessibleComplaintOrThrow(
      user,
      complaintId,
    );
    const isTenant = complaint.tenant.userId === user.id;

    const canSeeInternal = user.platformRole === 'SUPER_ADMIN' || !isTenant;

    const comments = await this.prisma.complaintComment.findMany({
      where: {
        complaintId,
        visibility: canSeeInternal ? undefined : 'PUBLIC',
      },
      orderBy: { createdAt: 'asc' },
    });
    return comments.map(ComplaintCommentResponseDto.fromEntity);
  }
}
