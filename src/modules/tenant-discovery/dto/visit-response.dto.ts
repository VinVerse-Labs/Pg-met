import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PropertyVisit, VisitStatus } from '@prisma/client';

export class VisitResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() propertyId!: string;
  @ApiProperty() applicationId!: string;
  @ApiPropertyOptional() applicantUserId?: string | null;
  @ApiPropertyOptional() scheduledStartAt?: Date | null;
  @ApiPropertyOptional() scheduledEndAt?: Date | null;
  @ApiProperty({ enum: VisitStatus }) status!: VisitStatus;
  @ApiPropertyOptional() notes?: string | null;
  @ApiPropertyOptional() cancelReason?: string | null;
  @ApiProperty() createdByUserId!: string;
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;

  static fromEntity(entity: PropertyVisit): VisitResponseDto {
    const dto = new VisitResponseDto();
    dto.id = entity.id;
    dto.organizationId = entity.organizationId;
    dto.propertyId = entity.propertyId;
    dto.applicationId = entity.applicationId;
    dto.applicantUserId = entity.applicantUserId;
    dto.scheduledStartAt = entity.scheduledStartAt;
    dto.scheduledEndAt = entity.scheduledEndAt;
    dto.status = entity.status;
    dto.notes = entity.notes;
    dto.cancelReason = entity.cancelReason;
    dto.createdByUserId = entity.createdByUserId;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
