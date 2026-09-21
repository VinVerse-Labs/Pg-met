import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  Amenity,
  Property,
  PropertyListing,
  PropertyType,
} from '@prisma/client';

// The dedicated public-safe response shape (spec: "never return raw
// Prisma rows"). Deliberately excludes: organizationId, owner email/
// phone, membershipIds, tenant data, room/bed ids, financial/settlement
// data, audit data - only what a prospective tenant should ever see.
export class PublicPropertySummaryDto {
  @ApiProperty() listingId!: string;
  @ApiProperty() propertyId!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ enum: PropertyType }) propertyType!: PropertyType;
  @ApiProperty() city!: string;
  @ApiPropertyOptional() locality?: string | null;
  @ApiPropertyOptional() coverImageUrl?: string | null;
  @ApiPropertyOptional() startingFromPrice?: string | null;

  static fromEntity(
    listing: PropertyListing & {
      property: Pick<Property, 'propertyType' | 'city'>;
    },
  ): PublicPropertySummaryDto {
    const dto = new PublicPropertySummaryDto();
    dto.listingId = listing.id;
    dto.propertyId = listing.propertyId;
    dto.title = listing.title ?? '';
    dto.propertyType = listing.property.propertyType;
    dto.city = listing.city ?? listing.property.city;
    dto.locality = listing.locality;
    dto.coverImageUrl = listing.coverImageUrl;
    dto.startingFromPrice = listing.startingFromPrice
      ? listing.startingFromPrice.toString()
      : null;
    return dto;
  }
}

export interface RoomTypeAvailability {
  roomType: string;
  availableBeds: number;
}

export class PublicPropertyDetailDto extends PublicPropertySummaryDto {
  @ApiPropertyOptional() description?: string | null;
  @ApiPropertyOptional() latitude?: number | null;
  @ApiPropertyOptional() longitude?: number | null;
  @ApiProperty() contactEnabled!: boolean;
  @ApiProperty({ enum: Amenity, isArray: true }) amenities!: Amenity[];
  @ApiProperty({ type: 'array' }) roomTypeAvailability!: RoomTypeAvailability[];

  static fromDetail(
    listing: PropertyListing & {
      property: Pick<Property, 'propertyType' | 'city'>;
    },
    amenities: Amenity[],
    roomTypeAvailability: RoomTypeAvailability[],
  ): PublicPropertyDetailDto {
    const base = PublicPropertySummaryDto.fromEntity(listing);
    const dto = new PublicPropertyDetailDto();
    Object.assign(dto, base);
    dto.description = listing.description;
    dto.latitude = listing.latitude;
    dto.longitude = listing.longitude;
    dto.contactEnabled = listing.contactEnabled;
    dto.amenities = amenities;
    dto.roomTypeAvailability = roomTypeAvailability;
    return dto;
  }
}
