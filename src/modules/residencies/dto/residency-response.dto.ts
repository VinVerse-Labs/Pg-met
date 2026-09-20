import { ApiProperty } from '@nestjs/swagger';
import { Residency, ResidencyStatus } from '@prisma/client';

export class ResidencyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  propertyId!: string;

  @ApiProperty()
  startDate!: Date;

  @ApiProperty({ nullable: true, type: Date })
  expectedEndDate!: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  actualEndDate!: Date | null;

  @ApiProperty({ enum: ResidencyStatus })
  status!: ResidencyStatus;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(residency: Residency): ResidencyResponseDto {
    const dto = new ResidencyResponseDto();
    dto.id = residency.id;
    dto.tenantId = residency.tenantId;
    dto.propertyId = residency.propertyId;
    dto.startDate = residency.startDate;
    dto.expectedEndDate = residency.expectedEndDate;
    dto.actualEndDate = residency.actualEndDate;
    dto.status = residency.status;
    dto.createdAt = residency.createdAt;
    return dto;
  }
}
