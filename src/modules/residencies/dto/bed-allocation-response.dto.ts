import { ApiProperty } from '@nestjs/swagger';
import { BedAllocation, BedAllocationStatus } from '@prisma/client';

export class BedAllocationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  residencyId!: string;

  @ApiProperty()
  bedId!: string;

  @ApiProperty()
  startDate!: Date;

  @ApiProperty({ nullable: true, type: Date })
  endDate!: Date | null;

  @ApiProperty({ enum: BedAllocationStatus })
  status!: BedAllocationStatus;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(allocation: BedAllocation): BedAllocationResponseDto {
    const dto = new BedAllocationResponseDto();
    dto.id = allocation.id;
    dto.residencyId = allocation.residencyId;
    dto.bedId = allocation.bedId;
    dto.startDate = allocation.startDate;
    dto.endDate = allocation.endDate;
    dto.status = allocation.status;
    dto.createdAt = allocation.createdAt;
    return dto;
  }
}
