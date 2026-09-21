import { HttpStatus, Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ComplaintsService } from './complaints.service';
import {
  ALLOWED_MIME_TYPES,
  CreateAttachmentDto,
  MAX_SIZE_BYTES,
} from './dto/create-attachment.dto';
import { ComplaintAttachmentResponseDto } from './dto/complaint-attachment-response.dto';

// A minimal reference registry, never a file-upload endpoint (see the
// schema's own doc comment on ComplaintAttachment). Any caller who can
// already view the complaint may attach a photo to it - the same
// audience as PUBLIC comments; deletion is narrower (see `remove`).
@Injectable()
export class ComplaintAttachmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly complaints: ComplaintsService,
  ) {}

  async create(
    user: AuthenticatedUser,
    complaintId: string,
    dto: CreateAttachmentDto,
  ): Promise<ComplaintAttachmentResponseDto> {
    const complaint = await this.complaints.getAccessibleComplaintOrThrow(
      user,
      complaintId,
    );
    if (user.platformRole !== 'SUPER_ADMIN') {
      await this.complaints.assertOrganizationWritableOrThrow(
        complaint.organizationId,
      );
    }

    // Defense in depth alongside the DTO's own validators - never trust
    // a single validation layer for security-relevant input (spec:
    // "validate allowed MIME types, file size").
    if (!ALLOWED_MIME_TYPES.includes(dto.mimeType)) {
      throw new AppException(
        ErrorCode.COMPLAINT_ATTACHMENT_NOT_ALLOWED,
        `File type ${dto.mimeType} is not allowed.`,
        HttpStatus.BAD_REQUEST,
      );
    }
    if (dto.size > MAX_SIZE_BYTES) {
      throw new AppException(
        ErrorCode.COMPLAINT_ATTACHMENT_NOT_ALLOWED,
        'File exceeds the maximum allowed size.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const attachment = await this.prisma.complaintAttachment.create({
      data: {
        complaintId,
        uploadedByUserId: user.id,
        url: dto.url,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        size: dto.size,
      },
    });
    return ComplaintAttachmentResponseDto.fromEntity(attachment);
  }

  async findForComplaint(
    user: AuthenticatedUser,
    complaintId: string,
  ): Promise<ComplaintAttachmentResponseDto[]> {
    await this.complaints.getAccessibleComplaintOrThrow(user, complaintId);
    const attachments = await this.prisma.complaintAttachment.findMany({
      where: { complaintId },
      orderBy: { createdAt: 'asc' },
    });
    return attachments.map(ComplaintAttachmentResponseDto.fromEntity);
  }

  // Never allow a caller to delete another user's attachment (spec) -
  // the uploader may always remove their own; OWNER/MANAGER may remove
  // any attachment within their organization (moderation).
  async remove(
    user: AuthenticatedUser,
    complaintId: string,
    attachmentId: string,
  ): Promise<void> {
    const complaint = await this.complaints.getAccessibleComplaintOrThrow(
      user,
      complaintId,
    );
    const attachment = await this.prisma.complaintAttachment.findFirst({
      where: { id: attachmentId, complaintId },
    });
    if (!attachment) {
      throw new AppException(
        ErrorCode.COMPLAINT_ATTACHMENT_NOT_ALLOWED,
        'Attachment not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    const isUploader = attachment.uploadedByUserId === user.id;
    let isModerator = user.platformRole === 'SUPER_ADMIN';
    if (!isModerator && !isUploader) {
      const membership = await this.memberships.getActiveMembership(
        user.id,
        complaint.organizationId,
      );
      isModerator =
        !!membership && ['OWNER', 'MANAGER'].includes(membership.role);
    }
    if (!isUploader && !isModerator) {
      throw new AppException(
        ErrorCode.COMPLAINT_ATTACHMENT_NOT_ALLOWED,
        'You cannot delete another user’s attachment.',
        HttpStatus.FORBIDDEN,
      );
    }

    await this.prisma.complaintAttachment.delete({
      where: { id: attachmentId },
    });
  }
}
