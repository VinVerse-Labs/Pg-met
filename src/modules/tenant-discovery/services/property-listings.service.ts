import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PropertyListing } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { UpsertListingDto } from '../dto/create-listing.dto';
import { ListingResponseDto } from '../dto/listing-response.dto';

const MANAGE_ROLES = ['OWNER', 'MANAGER'] as const;
const READ_ROLES = ['OWNER', 'MANAGER', 'STAFF'] as const;

type ListingWithAmenities = PropertyListing & {
  amenities: { amenity: import('@prisma/client').Amenity }[];
};

// One listing per property (spec: "one owner-facing PropertyListing per
// Property"). Never mutates Property itself - marketing fields
// (title/description/locality/amenities/price) live only here, the same
// separation FoodConfiguration keeps from Property.
@Injectable()
export class PropertyListingsService {
  private readonly logger = new Logger(PropertyListingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
  ) {}

  async getOrCreate(
    user: AuthenticatedUser,
    propertyId: string,
  ): Promise<ListingResponseDto> {
    const property = await this.getPropertyForRoles(
      user,
      propertyId,
      READ_ROLES,
    );
    let listing = await this.prisma.propertyListing.findUnique({
      where: { propertyId },
      include: { amenities: true },
    });
    if (!listing) {
      listing = await this.prisma.propertyListing.create({
        data: { organizationId: property.organizationId, propertyId },
        include: { amenities: true },
      });
    }
    return ListingResponseDto.fromEntity(listing as ListingWithAmenities);
  }

  async upsert(
    user: AuthenticatedUser,
    propertyId: string,
    dto: UpsertListingDto,
  ): Promise<ListingResponseDto> {
    const property = await this.getPropertyForRoles(
      user,
      propertyId,
      MANAGE_ROLES,
    );

    const listing = await this.prisma.$transaction(async (tx) => {
      const existing = await tx.propertyListing.findUnique({
        where: { propertyId },
      });
      const saved = existing
        ? await tx.propertyListing.update({
            where: { propertyId },
            data: {
              title: dto.title ?? existing.title,
              description: dto.description ?? existing.description,
              locality: dto.locality ?? existing.locality,
              latitude: dto.latitude ?? existing.latitude,
              longitude: dto.longitude ?? existing.longitude,
              coverImageUrl: dto.coverImageUrl ?? existing.coverImageUrl,
              contactEnabled: dto.contactEnabled ?? existing.contactEnabled,
              startingFromPrice:
                dto.startingFromPrice !== undefined
                  ? dto.startingFromPrice
                  : existing.startingFromPrice,
              city: property.city,
            },
          })
        : await tx.propertyListing.create({
            data: {
              organizationId: property.organizationId,
              propertyId,
              title: dto.title,
              description: dto.description,
              locality: dto.locality,
              latitude: dto.latitude,
              longitude: dto.longitude,
              coverImageUrl: dto.coverImageUrl,
              contactEnabled: dto.contactEnabled ?? true,
              startingFromPrice: dto.startingFromPrice,
              city: property.city,
            },
          });

      if (dto.amenities) {
        await tx.propertyListingAmenity.deleteMany({
          where: { propertyListingId: saved.id },
        });
        if (dto.amenities.length > 0) {
          await tx.propertyListingAmenity.createMany({
            data: dto.amenities.map((amenity) => ({
              propertyListingId: saved.id,
              amenity,
            })),
            skipDuplicates: true,
          });
        }
      }
      return tx.propertyListing.findUniqueOrThrow({
        where: { id: saved.id },
        include: { amenities: true },
      });
    });

    return ListingResponseDto.fromEntity(listing as ListingWithAmenities);
  }

  async publish(
    user: AuthenticatedUser,
    propertyId: string,
  ): Promise<ListingResponseDto> {
    await this.getPropertyForRoles(user, propertyId, MANAGE_ROLES);
    const listing = await this.prisma.propertyListing.findUnique({
      where: { propertyId },
    });
    if (!listing) {
      throw new AppException(
        ErrorCode.LISTING_NOT_FOUND,
        'Create a listing before publishing it.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (
      !listing.title ||
      !listing.description ||
      !listing.city ||
      !listing.locality
    ) {
      throw new AppException(
        ErrorCode.LISTING_INCOMPLETE,
        'title, description, city and locality are required to publish a listing.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const updated = await this.prisma.propertyListing.update({
      where: { propertyId },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
      include: { amenities: true },
    });
    this.logger.log(
      `LISTING_PUBLISHED listing=${updated.id} property=${propertyId}`,
    );
    return ListingResponseDto.fromEntity(updated as ListingWithAmenities);
  }

  async unpublish(
    user: AuthenticatedUser,
    propertyId: string,
  ): Promise<ListingResponseDto> {
    await this.getPropertyForRoles(user, propertyId, MANAGE_ROLES);
    const listing = await this.prisma.propertyListing.findUnique({
      where: { propertyId },
    });
    if (!listing) {
      throw new AppException(
        ErrorCode.LISTING_NOT_FOUND,
        'Listing not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const updated = await this.prisma.propertyListing.update({
      where: { propertyId },
      data: { status: 'UNPUBLISHED' },
      include: { amenities: true },
    });
    return ListingResponseDto.fromEntity(updated as ListingWithAmenities);
  }

  private async getPropertyForRoles(
    user: AuthenticatedUser,
    propertyId: string,
    allowedRoles: readonly string[],
  ): Promise<{ organizationId: string; city: string }> {
    const property = await this.prisma.property.findUnique({
      where: { id: propertyId },
      select: { organizationId: true, city: true },
    });
    if (!property) {
      throw new AppException(
        ErrorCode.PROPERTY_NOT_FOUND,
        'Property not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (user.platformRole === 'SUPER_ADMIN') {
      return property;
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      property.organizationId,
    );
    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new AppException(
        ErrorCode.PROPERTY_NOT_FOUND,
        'Property not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return property;
  }
}
