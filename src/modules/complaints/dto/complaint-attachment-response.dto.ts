import { ApiProperty } from '@nestjs/swagger';
import { ComplaintAttachment } from '@prisma/client';

export class ComplaintAttachmentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  uploadedByUserId!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty()
  fileName!: string;

  @ApiProperty()
  mimeType!: string;

  @ApiProperty()
  size!: number;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(
    attachment: ComplaintAttachment,
  ): ComplaintAttachmentResponseDto {
    const dto = new ComplaintAttachmentResponseDto();
    dto.id = attachment.id;
    dto.uploadedByUserId = attachment.uploadedByUserId;
    dto.url = attachment.url;
    dto.fileName = attachment.fileName;
    dto.mimeType = attachment.mimeType;
    dto.size = attachment.size;
    dto.createdAt = attachment.createdAt;
    return dto;
  }
}
