import { ApiProperty } from '@nestjs/swagger';
import {
  Prisma,
  Room,
  RoomAmenity,
  RoomStatus,
  RoomType,
} from '@prisma/client';

// Phase 13: per-room bed occupancy, computed from non-archived beds and
// their ACTIVE BedAllocations (a partial unique index allows at most one
// ACTIVE allocation per bed, so "occupied" is exact).
export class RoomOccupancyDto {
  @ApiProperty({ description: 'Non-archived beds in the room.' })
  totalBeds!: number;

  @ApiProperty({ description: 'Beds with an ACTIVE allocation.' })
  occupiedBeds!: number;

  @ApiProperty({
    description: 'AVAILABLE (in service) beds with no ACTIVE allocation.',
  })
  vacantBeds!: number;

  @ApiProperty({
    description: 'INACTIVE (out of service) beds with no ACTIVE allocation.',
  })
  blockedBeds!: number;
}

export class RoomResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  propertyId!: string;

  @ApiProperty()
  roomNumber!: string;

  @ApiProperty({ nullable: true, type: Number })
  floor!: number | null;

  @ApiProperty({ enum: RoomType })
  roomType!: RoomType;

  @ApiProperty()
  capacity!: number;

  @ApiProperty({ enum: RoomStatus })
  status!: RoomStatus;

  @ApiProperty({
    nullable: true,
    type: String,
    example: '7000.00',
    description: 'Advertised monthly price per bed (decimal string).',
  })
  pricePerBed!: string | null;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: RoomAmenity, isArray: true })
  amenities!: RoomAmenity[];

  @ApiProperty({ nullable: true, type: String })
  imageUrl!: string | null;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ type: RoomOccupancyDto })
  occupancy!: RoomOccupancyDto;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(
    room: Room,
    occupancy: RoomOccupancyDto = EMPTY_OCCUPANCY,
  ): RoomResponseDto {
    const dto = new RoomResponseDto();
    dto.id = room.id;
    dto.propertyId = room.propertyId;
    dto.roomNumber = room.roomNumber;
    dto.floor = room.floor;
    dto.roomType = room.roomType;
    dto.capacity = room.capacity;
    dto.status = room.status;
    dto.pricePerBed =
      room.pricePerBed == null
        ? null
        : new Prisma.Decimal(room.pricePerBed).toFixed(2);
    dto.currency = room.currency ?? 'INR';
    dto.amenities = room.amenities ?? [];
    dto.imageUrl = room.imageUrl ?? null;
    dto.description = room.description ?? null;
    dto.occupancy = occupancy;
    dto.createdAt = room.createdAt;
    return dto;
  }
}

export const EMPTY_OCCUPANCY: RoomOccupancyDto = {
  totalBeds: 0,
  occupiedBeds: 0,
  vacantBeds: 0,
  blockedBeds: 0,
};
