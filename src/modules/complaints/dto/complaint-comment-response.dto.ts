import { ApiProperty } from '@nestjs/swagger';
import { ComplaintComment, ComplaintCommentVisibility } from '@prisma/client';

export class ComplaintCommentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  authorUserId!: string;

  @ApiProperty()
  body!: string;

  @ApiProperty({ enum: ComplaintCommentVisibility })
  visibility!: ComplaintCommentVisibility;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(comment: ComplaintComment): ComplaintCommentResponseDto {
    const dto = new ComplaintCommentResponseDto();
    dto.id = comment.id;
    dto.authorUserId = comment.authorUserId;
    dto.body = comment.body;
    dto.visibility = comment.visibility;
    dto.createdAt = comment.createdAt;
    return dto;
  }
}
