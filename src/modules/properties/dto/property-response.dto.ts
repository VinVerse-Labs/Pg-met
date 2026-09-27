import { ApiProperty } from '@nestjs/swagger';
import { Property, PropertyStatus, PropertyType } from '@prisma/client';

export class PropertyResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: PropertyType })
  propertyType!: PropertyType;

  @ApiProperty()
  addressLine1!: string;

  @ApiProperty({ nullable: true, type: String })
  addressLine2!: string | null;

  @ApiProperty()
  city!: string;

  @ApiProperty()
  state!: string;

  @ApiProperty()
  postalCode!: string;

  @ApiProperty({ enum: PropertyStatus })
  status!: PropertyStatus;

  @ApiProperty({ example: 'Asia/Kolkata' })
  timezone!: string;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(property: Property): PropertyResponseDto {
    const dto = new PropertyResponseDto();
    dto.id = property.id;
    dto.organizationId = property.organizationId;
    dto.name = property.name;
    dto.propertyType = property.propertyType;
    dto.addressLine1 = property.addressLine1;
    dto.addressLine2 = property.addressLine2;
    dto.city = property.city;
    dto.state = property.state;
    dto.postalCode = property.postalCode;
    dto.status = property.status;
    dto.timezone = property.timezone;
    dto.createdAt = property.createdAt;
    return dto;
  }
}
