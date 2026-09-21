import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ApplicationStatus, RoomType, TenantApplication } from '@prisma/client';

// The one shared response DTO for every application-reading endpoint
// (owner/manager, applicant, and admin). `internalReviewNotes` is
// deliberately NEVER a field on this class - it must never appear in any
// applicant-facing or public response (spec, mandatory).
export class ApplicationResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() propertyId!: string;
  @ApiPropertyOptional() applicantUserId?: string | null;
  @ApiProperty() fullName!: string;
  @ApiProperty() phone!: string;
  @ApiPropertyOptional() email?: string | null;
  @ApiProperty({ enum: ApplicationStatus }) status!: ApplicationStatus;
  @ApiPropertyOptional() preferredMoveInDate?: Date | null;
  @ApiPropertyOptional({ enum: RoomType }) preferredRoomType?: RoomType | null;
  @ApiPropertyOptional() preferredStayDuration?: number | null;
  @ApiPropertyOptional() notes?: string | null;
  @ApiPropertyOptional() rejectionReason?: string | null;
  @ApiPropertyOptional() reviewedByUserId?: string | null;
  @ApiPropertyOptional() reviewedAt?: Date | null;
  @ApiPropertyOptional() decisionAt?: Date | null;
  @ApiProperty() submittedAt!: Date;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromEntity(entity: TenantApplication): ApplicationResponseDto {
    const dto = new ApplicationResponseDto();
    dto.id = entity.id;
    dto.organizationId = entity.organizationId;
    dto.propertyId = entity.propertyId;
    dto.applicantUserId = entity.applicantUserId;
    dto.fullName = entity.fullName;
    dto.phone = entity.phone;
    dto.email = entity.email;
    dto.status = entity.status;
    dto.preferredMoveInDate = entity.preferredMoveInDate;
    dto.preferredRoomType = entity.preferredRoomType;
    dto.preferredStayDuration = entity.preferredStayDuration;
    dto.notes = entity.notes;
    dto.rejectionReason = entity.rejectionReason;
    dto.reviewedByUserId = entity.reviewedByUserId;
    dto.reviewedAt = entity.reviewedAt;
    dto.decisionAt = entity.decisionAt;
    dto.submittedAt = entity.submittedAt;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
