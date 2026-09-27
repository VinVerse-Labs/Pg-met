import { ErrorCode } from '../../../common/constants/error-code.enum';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MembershipsService } from '../../memberships/memberships.service';
import { AdminListingsService } from './admin-listings.service';
import { PropertyListingsService } from './property-listings.service';

const admin: AuthenticatedUser = {
  id: 'admin-1',
  name: 'Platform Admin',
  email: 'admin@pgmet.test',
  phone: null,
  status: 'ACTIVE',
  platformRole: 'SUPER_ADMIN',
};

function listingRow(overrides: Record<string, unknown> = {}) {
  return {
    id: 'listing-1',
    organizationId: 'org-1',
    propertyId: 'prop-1',
    status: 'DRAFT',
    title: 'Sunrise PG',
    description: 'Clean rooms',
    city: 'Hyderabad',
    locality: 'Madhapur',
    latitude: null,
    longitude: null,
    coverImageUrl: null,
    contactEnabled: true,
    startingFromPrice: null,
    amenities: [],
    createdAt: new Date(),
    updatedAt: new Date(),
    publishedAt: null,
    ...overrides,
  };
}

describe('AdminListingsService', () => {
  let prisma: any;
  let auditLog: { record: jest.Mock };
  let memberships: { getActiveMembership: jest.Mock };
  let service: AdminListingsService;

  beforeEach(() => {
    prisma = {
      property: {
        findUnique: jest
          .fn()
          .mockResolvedValue({ organizationId: 'org-1', city: 'Hyderabad' }),
      },
      propertyListing: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
    };
    auditLog = { record: jest.fn() };
    memberships = { getActiveMembership: jest.fn() };
    // The real PropertyListingsService: the completeness rule must be the
    // exact one owners get, not a copy.
    const listings = new PropertyListingsService(
      prisma,
      memberships as unknown as MembershipsService,
    );
    service = new AdminListingsService(
      prisma,
      listings,
      auditLog as unknown as AuditLogService,
    );
  });

  describe('getForProperty', () => {
    it('returns the listing without ever creating one', async () => {
      prisma.propertyListing.findUnique.mockResolvedValue(listingRow());
      await expect(service.getForProperty('prop-1')).resolves.toMatchObject({
        id: 'listing-1',
        status: 'DRAFT',
      });
      expect(prisma.propertyListing.create).not.toHaveBeenCalled();
    });

    it('404s LISTING_NOT_FOUND (no lazy DRAFT) when the owner never created one', async () => {
      prisma.propertyListing.findUnique.mockResolvedValue(null);
      await expect(service.getForProperty('prop-1')).rejects.toMatchObject({
        code: ErrorCode.LISTING_NOT_FOUND,
      });
      expect(prisma.propertyListing.create).not.toHaveBeenCalled();
    });
  });

  describe('publish', () => {
    it('publishes a complete listing, bypassing membership, and audit-logs it', async () => {
      prisma.propertyListing.findUnique.mockResolvedValue(listingRow());
      prisma.propertyListing.update.mockResolvedValue(
        listingRow({ status: 'PUBLISHED', publishedAt: new Date() }),
      );

      const result = await service.publish(admin, 'prop-1');

      expect(result.status).toBe('PUBLISHED');
      expect(memberships.getActiveMembership).not.toHaveBeenCalled();
      expect(auditLog.record).toHaveBeenCalledWith({
        actorUserId: 'admin-1',
        action: 'LISTING_PUBLISHED',
        entityType: 'PropertyListing',
        entityId: 'listing-1',
        organizationId: 'org-1',
        metadata: {
          propertyId: 'prop-1',
          previousStatus: 'DRAFT',
          nextStatus: 'PUBLISHED',
        },
      });
    });

    it('applies the same completeness rule as owners (LISTING_INCOMPLETE) and writes no audit entry', async () => {
      prisma.propertyListing.findUnique.mockResolvedValue(
        listingRow({ description: null, locality: null }),
      );
      await expect(service.publish(admin, 'prop-1')).rejects.toMatchObject({
        code: ErrorCode.LISTING_INCOMPLETE,
      });
      expect(prisma.propertyListing.update).not.toHaveBeenCalled();
      expect(auditLog.record).not.toHaveBeenCalled();
    });

    it('409s LISTING_ALREADY_PUBLISHED instead of re-stamping publishedAt', async () => {
      prisma.propertyListing.findUnique.mockResolvedValue(
        listingRow({ status: 'PUBLISHED' }),
      );
      await expect(service.publish(admin, 'prop-1')).rejects.toMatchObject({
        code: ErrorCode.LISTING_ALREADY_PUBLISHED,
      });
      expect(prisma.propertyListing.update).not.toHaveBeenCalled();
    });

    it('404s when the property has no listing', async () => {
      prisma.propertyListing.findUnique.mockResolvedValue(null);
      await expect(service.publish(admin, 'prop-1')).rejects.toMatchObject({
        code: ErrorCode.LISTING_NOT_FOUND,
      });
    });
  });

  describe('unpublish', () => {
    it('unpublishes a published listing and audit-logs it', async () => {
      prisma.propertyListing.findUnique.mockResolvedValue(
        listingRow({ status: 'PUBLISHED' }),
      );
      prisma.propertyListing.update.mockResolvedValue(
        listingRow({ status: 'UNPUBLISHED' }),
      );

      const result = await service.unpublish(admin, 'prop-1');

      expect(result.status).toBe('UNPUBLISHED');
      expect(auditLog.record).toHaveBeenCalledWith(
        expect.objectContaining({
          action: 'LISTING_UNPUBLISHED',
          metadata: expect.objectContaining({
            previousStatus: 'PUBLISHED',
            nextStatus: 'UNPUBLISHED',
          }),
        }),
      );
    });

    it('409s LISTING_NOT_PUBLISHED for a draft', async () => {
      prisma.propertyListing.findUnique.mockResolvedValue(listingRow());
      await expect(service.unpublish(admin, 'prop-1')).rejects.toMatchObject({
        code: ErrorCode.LISTING_NOT_PUBLISHED,
      });
      expect(auditLog.record).not.toHaveBeenCalled();
    });
  });
});
