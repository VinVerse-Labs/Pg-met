import { ApiProperty } from '@nestjs/swagger';
import { Bed, BedBerth, BedStatus } from '@prisma/client';

// Phase 13: who is in the bed right now (from its ACTIVE BedAllocation).
// Name/phone come from the tenant's User; monthlyRent from their ACTIVE
// RentPlan, if one is set. Visible to active members of the property's
// organization - the same audience that manages the tenant's stay.
export class BedOccupantDto {
  @ApiProperty()
  residencyId!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  phone!: string | null;

  @ApiProperty({ description: 'Check-in date of the current allocation.' })
  since!: Date;

  @ApiProperty({ nullable: true, type: String, example: '7000.00' })
  monthlyRent!: string | null;

  @ApiProperty({ nullable: true, type: String })
  currency!: string | null;
}

export class BedResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  roomId!: string;

  @ApiProperty()
  bedNumber!: string;

  @ApiProperty({ enum: BedStatus })
  status!: BedStatus;

  @ApiProperty({ enum: BedBerth, nullable: true })
  berth!: BedBerth | null;

  @ApiProperty({ type: BedOccupantDto, nullable: true })
  occupant!: BedOccupantDto | null;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(
    bed: Bed,
    occupant: BedOccupantDto | null = null,
  ): BedResponseDto {
    const dto = new BedResponseDto();
    dto.id = bed.id;
    dto.roomId = bed.roomId;
    dto.bedNumber = bed.bedNumber;
    dto.status = bed.status;
    dto.berth = bed.berth ?? null;
    dto.occupant = occupant;
    dto.createdAt = bed.createdAt;
    return dto;
  }
}
