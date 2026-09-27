import { ApiProperty } from '@nestjs/swagger';
import {
  BedBerth,
  BillingCycle,
  PropertyType,
  ResidencyStatus,
  RoomType,
} from '@prisma/client';

// Tenant-facing view of their own stay (GET /me/residency). Only what a
// resident needs to know about where they live - no organization ids,
// no other residents, no room capacity/occupancy, no owner contact.
export class MyStayPropertyDto {
  @ApiProperty() id!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: PropertyType }) propertyType!: PropertyType;
  @ApiProperty() addressLine1!: string;
  @ApiProperty({ nullable: true, type: String }) addressLine2!: string | null;
  @ApiProperty() city!: string;
  @ApiProperty() state!: string;
  @ApiProperty() postalCode!: string;
}

export class MyStayRoomDto {
  @ApiProperty() roomNumber!: string;
  @ApiProperty({ nullable: true, type: Number }) floor!: number | null;
  @ApiProperty({ enum: RoomType }) roomType!: RoomType;
}

export class MyStayBedDto {
  @ApiProperty() bedNumber!: string;
  @ApiProperty({ enum: BedBerth, nullable: true }) berth!: BedBerth | null;
  @ApiProperty({ description: 'When this bed allocation started.' })
  since!: Date;
}

export class MyStayRentDto {
  @ApiProperty({ example: '8500.00' }) amount!: string;
  @ApiProperty() currency!: string;
  @ApiProperty({ enum: BillingCycle }) billingCycle!: BillingCycle;
  @ApiProperty({ description: 'Day of the month rent is due.' })
  dueDay!: number;
}

export class MyStayResponseDto {
  @ApiProperty() residencyId!: string;
  @ApiProperty({ enum: ResidencyStatus }) status!: ResidencyStatus;
  @ApiProperty() startDate!: Date;
  @ApiProperty({ nullable: true, type: Date }) expectedEndDate!: Date | null;
  @ApiProperty({ type: MyStayPropertyDto }) property!: MyStayPropertyDto;
  @ApiProperty({
    type: MyStayRoomDto,
    nullable: true,
    description: 'null until the tenant is checked in to a bed.',
  })
  room!: MyStayRoomDto | null;
  @ApiProperty({ type: MyStayBedDto, nullable: true })
  bed!: MyStayBedDto | null;
  @ApiProperty({
    type: MyStayRentDto,
    nullable: true,
    description: 'The ACTIVE rent plan, if one has been set up.',
  })
  rent!: MyStayRentDto | null;
}
