import { ApiProperty } from '@nestjs/swagger';
import { BedAllocation, BedAllocationStatus } from '@prisma/client';

type AllocationWithContext = BedAllocation & {
  bed: { bedNumber: string };
  residency: { tenantId: string; tenant: { user: { name: string } } };
};

// One check-in (and, once ended, check-out) of a tenant into a bed of this room.
export class RoomHistoryEntryDto {
  @ApiProperty()
  allocationId!: string;

  @ApiProperty()
  bedId!: string;

  @ApiProperty()
  bedNumber!: string;

  @ApiProperty()
  residencyId!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  tenantName!: string;

  @ApiProperty({ description: 'Check-in date.' })
  startDate!: Date;

  @ApiProperty({
    nullable: true,
    type: Date,
    description: 'Check-out date; null while the allocation is ACTIVE.',
  })
  endDate!: Date | null;

  @ApiProperty({ enum: BedAllocationStatus })
  status!: BedAllocationStatus;

  static fromEntity(allocation: AllocationWithContext): RoomHistoryEntryDto {
    const dto = new RoomHistoryEntryDto();
    dto.allocationId = allocation.id;
    dto.bedId = allocation.bedId;
    dto.bedNumber = allocation.bed.bedNumber;
    dto.residencyId = allocation.residencyId;
    dto.tenantId = allocation.residency.tenantId;
    dto.tenantName = allocation.residency.tenant.user.name;
    dto.startDate = allocation.startDate;
    dto.endDate = allocation.endDate;
    dto.status = allocation.status;
    return dto;
  }
}
