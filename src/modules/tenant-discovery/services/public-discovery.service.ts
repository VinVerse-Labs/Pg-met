import { HttpStatus, Injectable } from '@nestjs/common';
import { Amenity, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import {
  PaginatedResult,
  paginationSkipTake,
} from '../../../common/dto/pagination-query.dto';
import { ListPublicPropertiesQueryDto } from '../dto/list-public-properties.query.dto';
import {
  PublicPropertyDetailDto,
  PublicPropertySummaryDto,
  RoomTypeAvailability,
} from '../dto/public-property-response.dto';

// Every query here filters PUBLISHED listings whose Property is ACTIVE and
// whose Organization is not SUSPENDED at the query level (spec: "never
// trust the absence of a guard alone, always filter at the query level
// too") - this is the actual security boundary for the unguarded
// `/public/*` controller, not merely the lack of a route decorator.
function publicListingWhere(): Prisma.PropertyListingWhereInput {
  return {
    status: 'PUBLISHED',
    property: {
      status: 'ACTIVE',
      organization: { status: { not: 'SUSPENDED' } },
    },
  };
}

@Injectable()
export class PublicDiscoveryService {
  constructor(private readonly prisma: PrismaService) {}

  async list(
    query: ListPublicPropertiesQueryDto,
  ): Promise<PaginatedResult<PublicPropertySummaryDto>> {
    const { skip, take } = paginationSkipTake(query);

    const propertyFilter: Prisma.PropertyWhereInput = {
      status: 'ACTIVE',
      organization: { status: { not: 'SUSPENDED' } },
      propertyType: query.propertyType,
      foodConfiguration: query.foodAvailable
        ? { is: { enabled: true } }
        : undefined,
    };

    const where: Prisma.PropertyListingWhereInput = {
      status: 'PUBLISHED',
      city: query.city
        ? { equals: query.city, mode: 'insensitive' }
        : undefined,
      locality: query.locality
        ? { equals: query.locality, mode: 'insensitive' }
        : undefined,
      property: propertyFilter,
      startingFromPrice:
        query.minPrice !== undefined || query.maxPrice !== undefined
          ? {
              gte: query.minPrice !== undefined ? query.minPrice : undefined,
              lte: query.maxPrice !== undefined ? query.maxPrice : undefined,
            }
          : undefined,
    };

    if (query.availableBeds) {
      const rows = await this.prisma.$queryRaw<{ propertyId: string }[]>(
        Prisma.sql`
          SELECT DISTINCT r."propertyId" as "propertyId"
          FROM rooms r
          JOIN beds b ON b."roomId" = r.id
          WHERE r.status = 'ACTIVE' AND b.status = 'AVAILABLE'
            AND NOT EXISTS (
              SELECT 1 FROM bed_allocations ba
              WHERE ba."bedId" = b.id AND ba.status = 'ACTIVE'
            )
        `,
      );
      where.propertyId = { in: rows.map((r) => r.propertyId) };
    }

    const [rows, total] = await Promise.all([
      this.prisma.propertyListing.findMany({
        where,
        include: { property: { select: { propertyType: true, city: true } } },
        orderBy: { publishedAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.propertyListing.count({ where }),
    ]);

    return {
      items: rows.map((r) => PublicPropertySummaryDto.fromEntity(r)),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  async getOne(propertyId: string): Promise<PublicPropertyDetailDto> {
    const listing = await this.prisma.propertyListing.findFirst({
      where: { propertyId, ...publicListingWhere() },
      include: {
        property: { select: { propertyType: true, city: true } },
        amenities: true,
      },
    });
    if (!listing) {
      throw new AppException(
        ErrorCode.LISTING_NOT_FOUND,
        'Listing not found.',
        HttpStatus.NOT_FOUND,
      );
    }

    // Group Bed by Room.roomType, counting AVAILABLE beds with no current
    // ACTIVE allocation - done entirely in the database (spec: "do not
    // load all beds into Node").
    const rows = await this.prisma.$queryRaw<
      { roomType: string; availableBeds: bigint }[]
    >(
      Prisma.sql`
        SELECT r."roomType" as "roomType", COUNT(b.id)::int as "availableBeds"
        FROM rooms r
        JOIN beds b ON b."roomId" = r.id
        WHERE r."propertyId" = ${propertyId} AND r.status = 'ACTIVE' AND b.status = 'AVAILABLE'
          AND NOT EXISTS (
            SELECT 1 FROM bed_allocations ba
            WHERE ba."bedId" = b.id AND ba.status = 'ACTIVE'
          )
        GROUP BY r."roomType"
      `,
    );
    const roomTypeAvailability: RoomTypeAvailability[] = rows.map((r) => ({
      roomType: r.roomType,
      availableBeds: Number(r.availableBeds),
    }));

    const amenities: Amenity[] = listing.amenities.map((a) => a.amenity);
    return PublicPropertyDetailDto.fromDetail(
      listing,
      amenities,
      roomTypeAvailability,
    );
  }

  // Used by TenantApplicationsService.create to re-validate a property is
  // genuinely open for applications at submission time - never trusts a
  // client-supplied "this listing is published" claim.
  async assertApplicable(propertyId: string): Promise<{
    organizationId: string;
    listingId: string | null;
  }> {
    const listing = await this.prisma.propertyListing.findFirst({
      where: { propertyId, ...publicListingWhere() },
      select: { id: true, organizationId: true },
    });
    if (!listing) {
      throw new AppException(
        ErrorCode.PROPERTY_NOT_LISTABLE,
        'This property is not currently accepting applications.',
        HttpStatus.BAD_REQUEST,
      );
    }
    return { organizationId: listing.organizationId, listingId: listing.id };
  }
}
