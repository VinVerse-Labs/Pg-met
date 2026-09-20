import { ApiProperty } from '@nestjs/swagger';
import { Bed, BedStatus } from '@prisma/client';

export class BedResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  roomId!: string;

  @ApiProperty()
  bedNumber!: string;

  @ApiProperty({ enum: BedStatus })
  status!: BedStatus;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(bed: Bed): BedResponseDto {
    const dto = new BedResponseDto();
    dto.id = bed.id;
    dto.roomId = bed.roomId;
    dto.bedNumber = bed.bedNumber;
    dto.status = bed.status;
    dto.createdAt = bed.createdAt;
    return dto;
  }
}
