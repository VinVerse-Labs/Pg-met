import { ApiProperty } from '@nestjs/swagger';
import { PropertyStatus, PropertyType } from '@prisma/client';

export class AdminPropertyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  organizationName!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: PropertyType })
  propertyType!: PropertyType;

  @ApiProperty()
  city!: string;

  @ApiProperty()
  state!: string;

  @ApiProperty({ enum: PropertyStatus })
  status!: PropertyStatus;

  @ApiProperty()
  roomCount!: number;

  @ApiProperty()
  bedCount!: number;

  @ApiProperty()
  createdAt!: Date;
}
