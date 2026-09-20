import { ApiProperty } from '@nestjs/swagger';
import { Room, RoomStatus, RoomType } from '@prisma/client';

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

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(room: Room): RoomResponseDto {
    const dto = new RoomResponseDto();
    dto.id = room.id;
    dto.propertyId = room.propertyId;
    dto.roomNumber = room.roomNumber;
    dto.floor = room.floor;
    dto.roomType = room.roomType;
    dto.capacity = room.capacity;
    dto.status = room.status;
    dto.createdAt = room.createdAt;
    return dto;
  }
}
