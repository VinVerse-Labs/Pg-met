import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { PropertyListingsService } from './property-listings.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Owner',
    email: 'owner@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

describe('PropertyListingsService', () => {
  let service: PropertyListingsService;
  let prisma: any;
  let memberships: { getActiveMembership: jest.Mock };

  beforeEach(() => {
    prisma = {
      property: { findUnique: jest.fn() },
      propertyListing: {
        findUnique: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
        findUniqueOrThrow: jest.fn(),
      },
      propertyListingAmenity: { deleteMany: jest.fn(), createMany: jest.fn() },
      $transaction: jest.fn(),
    };
    memberships = { getActiveMembership: jest.fn() };
    service = new PropertyListingsService(
      prisma,
      memberships as unknown as MembershipsService,
    );
  });

  describe('publish', () => {
    it('rejects publishing an incomplete listing with LISTING_INCOMPLETE', async () => {
      prisma.property.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        city: 'Pune',
      });
      memberships.getActiveMembership.mockResolvedValue({ role: 'OWNER' });
      prisma.propertyListing.findUnique.mockResolvedValue({
        title: null,
        description: null,
        city: null,
        locality: null,
      });

      await expect(
        service.publish(buildUser(), 'prop-1'),
      ).rejects.toMatchObject({ code: ErrorCode.LISTING_INCOMPLETE });
    });

    it('publishes once title/description/city/locality are all present', async () => {
      prisma.property.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        city: 'Pune',
      });
      memberships.getActiveMembership.mockResolvedValue({ role: 'OWNER' });
      prisma.propertyListing.findUnique.mockResolvedValue({
        title: 'Sunrise PG',
        description: 'A nice place',
        city: 'Pune',
        locality: 'Kothrud',
      });
      prisma.propertyListing.update.mockResolvedValue({
        id: 'listing-1',
        status: 'PUBLISHED',
        amenities: [],
      });

      const result = await service.publish(buildUser(), 'prop-1');
      expect(result.status).toBe('PUBLISHED');
    });

    it('rejects STAFF from publishing (manage-only action)', async () => {
      prisma.property.findUnique.mockResolvedValue({
        organizationId: 'org-1',
        city: 'Pune',
      });
      memberships.getActiveMembership.mockResolvedValue({ role: 'STAFF' });

      await expect(
        service.publish(buildUser(), 'prop-1'),
      ).rejects.toMatchObject({ code: ErrorCode.PROPERTY_NOT_FOUND });
    });
  });

  describe('cross-organization isolation', () => {
    it('404s (never 403) when the caller has no membership in the property’s organization', async () => {
      prisma.property.findUnique.mockResolvedValue({
        organizationId: 'org-A',
        city: 'Pune',
      });
      memberships.getActiveMembership.mockResolvedValue(null);

      await expect(
        service.getOrCreate(buildUser({ id: 'user-in-org-B' }), 'prop-1'),
      ).rejects.toMatchObject({ code: ErrorCode.PROPERTY_NOT_FOUND });
    });
  });
});
