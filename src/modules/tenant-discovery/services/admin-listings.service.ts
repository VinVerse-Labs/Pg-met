import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { PropertyListingsService } from './property-listings.service';
import { ListingResponseDto } from '../dto/listing-response.dto';

// Super Admin listing moderation (PGMet Internal). Deliberately narrow:
// read one listing, publish, unpublish - never edit its content, which
// stays the owner's (the same "moderate, don't rewrite" posture as
// suspend/activate organization). Publish/unpublish delegate to
// PropertyListingsService so the completeness rule lives in exactly one
// place, and every change is written to the platform audit log like
// every other Phase 8 sensitive admin action.
@Injectable()
export class AdminListingsService {
  private readonly logger = new Logger(AdminListingsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly listings: PropertyListingsService,
    private readonly auditLog: AuditLogService,
  ) {}

  // Read-only on purpose: unlike GET /properties/:id/listing this never
  // lazily creates a DRAFT, so a Super Admin merely viewing a property
  // leaves no trace in the owner's data.
  async getForProperty(propertyId: string): Promise<ListingResponseDto> {
    const listing = await this.prisma.propertyListing.findUnique({
      where: { propertyId },
      include: { amenities: true },
    });
    if (!listing) throw this.notFound();
    return ListingResponseDto.fromEntity(listing);
  }

  async publish(
    admin: AuthenticatedUser,
    propertyId: string,
  ): Promise<ListingResponseDto> {
    const previous = await this.requireListing(propertyId);
    if (previous.status === 'PUBLISHED') {
      throw new AppException(
        ErrorCode.LISTING_ALREADY_PUBLISHED,
        'This listing is already published.',
        HttpStatus.CONFLICT,
      );
    }
    const updated = await this.listings.publish(admin, propertyId);
    await this.audit(admin, 'LISTING_PUBLISHED', updated, previous.status);
    return updated;
  }

  async unpublish(
    admin: AuthenticatedUser,
    propertyId: string,
  ): Promise<ListingResponseDto> {
    const previous = await this.requireListing(propertyId);
    if (previous.status !== 'PUBLISHED') {
      throw new AppException(
        ErrorCode.LISTING_NOT_PUBLISHED,
        'This listing is not published.',
        HttpStatus.CONFLICT,
      );
    }
    const updated = await this.listings.unpublish(admin, propertyId);
    await this.audit(admin, 'LISTING_UNPUBLISHED', updated, previous.status);
    return updated;
  }

  private async requireListing(propertyId: string) {
    const listing = await this.prisma.propertyListing.findUnique({
      where: { propertyId },
      select: { status: true },
    });
    if (!listing) throw this.notFound();
    return listing;
  }

  private async audit(
    admin: AuthenticatedUser,
    action: 'LISTING_PUBLISHED' | 'LISTING_UNPUBLISHED',
    listing: ListingResponseDto,
    previousStatus: string,
  ): Promise<void> {
    await this.auditLog.record({
      actorUserId: admin.id,
      action,
      entityType: 'PropertyListing',
      entityId: listing.id,
      organizationId: listing.organizationId,
      metadata: {
        propertyId: listing.propertyId,
        previousStatus,
        nextStatus: listing.status,
      },
    });
    this.logger.log(
      `${action} by SUPER_ADMIN listing=${listing.id} property=${listing.propertyId} admin=${admin.id}`,
    );
  }

  private notFound(): AppException {
    return new AppException(
      ErrorCode.LISTING_NOT_FOUND,
      'This property has no listing yet.',
      HttpStatus.NOT_FOUND,
    );
  }
}
