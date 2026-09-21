import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Amenity, ListingStatus, PropertyListing } from '@prisma/client';

// Owner/Manager-facing shape - safe to include organizationId/propertyId
// (the caller already has access to both). Never used for the public
// discovery response - see PublicPropertyResponseDto for that, deliberately
// separate DTO.
export class ListingResponseDto {
  @ApiProperty() id!: string;
  @ApiProperty() organizationId!: string;
  @ApiProperty() propertyId!: string;
  @ApiProperty({ enum: ListingStatus }) status!: ListingStatus;
  @ApiPropertyOptional() title?: string | null;
  @ApiPropertyOptional() description?: string | null;
  @ApiPropertyOptional() city?: string | null;
  @ApiPropertyOptional() locality?: string | null;
  @ApiPropertyOptional() latitude?: number | null;
  @ApiPropertyOptional() longitude?: number | null;
  @ApiPropertyOptional() coverImageUrl?: string | null;
  @ApiProperty() contactEnabled!: boolean;
  @ApiPropertyOptional() startingFromPrice?: string | null;
  @ApiProperty({ enum: Amenity, isArray: true }) amenities!: Amenity[];
  @ApiProperty() createdAt!: Date;
  @ApiProperty() updatedAt!: Date;
  @ApiPropertyOptional() publishedAt?: Date | null;

  static fromEntity(
    entity: PropertyListing & { amenities?: { amenity: Amenity }[] },
  ): ListingResponseDto {
    const dto = new ListingResponseDto();
    dto.id = entity.id;
    dto.organizationId = entity.organizationId;
    dto.propertyId = entity.propertyId;
    dto.status = entity.status;
    dto.title = entity.title;
    dto.description = entity.description;
    dto.city = entity.city;
    dto.locality = entity.locality;
    dto.latitude = entity.latitude;
    dto.longitude = entity.longitude;
    dto.coverImageUrl = entity.coverImageUrl;
    dto.contactEnabled = entity.contactEnabled;
    dto.startingFromPrice = entity.startingFromPrice
      ? entity.startingFromPrice.toString()
      : null;
    dto.amenities = (entity.amenities ?? []).map((a) => a.amenity);
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    dto.publishedAt = entity.publishedAt;
    return dto;
  }
}
