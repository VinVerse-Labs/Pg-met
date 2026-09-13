import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { PropertiesService } from './properties.service';

function buildUser(
  overrides: Partial<AuthenticatedUser> = {},
): AuthenticatedUser {
  return {
    id: 'user-1',
    name: 'Rahul',
    email: 'rahul@example.com',
    phone: null,
    status: 'ACTIVE',
    platformRole: 'USER',
    ...overrides,
  };
}

describe('PropertiesService', () => {
  let service: PropertiesService;
  let prisma: {
    property: {
      create: jest.Mock;
      findMany: jest.Mock;
      findFirst: jest.Mock;
      update: jest.Mock;
    };
  };
  let memberships: {
    assertOrganizationAccess: jest.Mock;
    assertRole: jest.Mock;
    listActiveOrganizationIds: jest.Mock;
    getActiveMembership: jest.Mock;
  };

  const createDto = {
    organizationId: 'org-1',
    name: 'ABC Gachibowli',
    addressLine1: '123 Main St',
    city: 'Hyderabad',
    state: 'Telangana',
    postalCode: '500032',
  };

  beforeEach(() => {
    prisma = {
      property: {
        create: jest.fn(),
        findMany: jest.fn(),
        findFirst: jest.fn(),
        update: jest.fn(),
      },
    };
    memberships = {
      assertOrganizationAccess: jest.fn(),
      assertRole: jest.fn(),
      listActiveOrganizationIds: jest.fn(),
      getActiveMembership: jest.fn(),
    };
    service = new PropertiesService(
      prisma as any,
      memberships as unknown as MembershipsService,
    );
  });

  describe('create', () => {
    it('checks organization access and role before creating', async () => {
      const membership = { role: 'OWNER' };
      memberships.assertOrganizationAccess.mockResolvedValue({
        organization: { id: 'org-1', status: 'ACTIVE' },
        membership,
      });
      prisma.property.create.mockResolvedValue({
        id: 'prop-1',
        ...createDto,
        propertyType: 'PG',
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      await service.create(buildUser(), createDto as any);

      expect(memberships.assertOrganizationAccess).toHaveBeenCalledWith(
        expect.anything(),
        'org-1',
      );
      expect(memberships.assertRole).toHaveBeenCalledWith(
        expect.anything(),
        membership,
        ['OWNER', 'MANAGER'],
      );
      expect(prisma.property.create).toHaveBeenCalled();
    });

    it('propagates the ORGANIZATION_NOT_FOUND error for a spoofed/inaccessible organizationId', async () => {
      memberships.assertOrganizationAccess.mockRejectedValue(
        Object.assign(new Error('not found'), {
          code: ErrorCode.ORGANIZATION_NOT_FOUND,
        }),
      );

      await expect(
        service.create(buildUser(), createDto as any),
      ).rejects.toMatchObject({ code: ErrorCode.ORGANIZATION_NOT_FOUND });
      expect(prisma.property.create).not.toHaveBeenCalled();
    });

    it('propagates INSUFFICIENT_ROLE for a STAFF member attempting to create', async () => {
      memberships.assertOrganizationAccess.mockResolvedValue({
        organization: { id: 'org-1', status: 'ACTIVE' },
        membership: { role: 'STAFF' },
      });
      memberships.assertRole.mockImplementation(() => {
        throw Object.assign(new Error('forbidden'), {
          code: ErrorCode.INSUFFICIENT_ROLE,
        });
      });

      await expect(
        service.create(buildUser(), createDto as any),
      ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_ROLE });
      expect(prisma.property.create).not.toHaveBeenCalled();
    });
  });

  describe('findOne / BOLA protection', () => {
    it("returns the property when it belongs to one of the caller's active organizations", async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue([
        'org-1',
        'org-2',
      ]);
      prisma.property.findFirst.mockResolvedValue({
        id: 'prop-1',
        ...createDto,
        propertyType: 'PG',
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      const result = await service.findOne(buildUser(), 'prop-1');

      expect(result.id).toBe('prop-1');
      expect(prisma.property.findFirst).toHaveBeenCalledWith({
        where: { id: 'prop-1', organizationId: { in: ['org-1', 'org-2'] } },
      });
    });

    it('returns PROPERTY_NOT_FOUND for a property belonging to another organization (IDOR)', async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      // The property exists in the DB (organizationId: org-99) but the
      // scoped query never returns it, simulating a real Prisma query
      // that filters by organizationId IN [...].
      prisma.property.findFirst.mockResolvedValue(null);

      await expect(
        service.findOne(buildUser(), 'prop-belonging-to-org-99'),
      ).rejects.toMatchObject({ code: ErrorCode.PROPERTY_NOT_FOUND });
    });

    it('lets a SUPER_ADMIN read any property without an organization filter', async () => {
      prisma.property.findFirst.mockResolvedValue({
        id: 'prop-1',
        ...createDto,
        organizationId: 'org-99',
        propertyType: 'PG',
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      await service.findOne(
        buildUser({ platformRole: 'SUPER_ADMIN' }),
        'prop-1',
      );

      expect(prisma.property.findFirst).toHaveBeenCalledWith({
        where: { id: 'prop-1' },
      });
      expect(memberships.listActiveOrganizationIds).not.toHaveBeenCalled();
    });
  });

  describe('update', () => {
    it('rejects a MANAGER-disallowed update the same way a missing property would look from outside (via findAccessiblePropertyRow first)', async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue([]);
      prisma.property.findFirst.mockResolvedValue(null);

      await expect(
        service.update(buildUser(), 'prop-in-other-org', { name: 'Hacked' }),
      ).rejects.toMatchObject({ code: ErrorCode.PROPERTY_NOT_FOUND });
      expect(prisma.property.update).not.toHaveBeenCalled();
    });

    it('rejects a STAFF member trying to update', async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.property.findFirst.mockResolvedValue({
        id: 'prop-1',
        organizationId: 'org-1',
      });
      memberships.getActiveMembership.mockResolvedValue({ role: 'STAFF' });
      memberships.assertRole.mockImplementation(() => {
        throw Object.assign(new Error('forbidden'), {
          code: ErrorCode.INSUFFICIENT_ROLE,
        });
      });

      await expect(
        service.update(buildUser(), 'prop-1', { name: 'New name' }),
      ).rejects.toMatchObject({ code: ErrorCode.INSUFFICIENT_ROLE });
      expect(prisma.property.update).not.toHaveBeenCalled();
    });

    it('allows a MANAGER to update', async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.property.findFirst.mockResolvedValue({
        id: 'prop-1',
        organizationId: 'org-1',
      });
      memberships.getActiveMembership.mockResolvedValue({ role: 'MANAGER' });
      prisma.property.update.mockResolvedValue({
        id: 'prop-1',
        ...createDto,
        name: 'New name',
        propertyType: 'PG',
        status: 'ACTIVE',
        createdAt: new Date(),
      });

      const result = await service.update(buildUser(), 'prop-1', {
        name: 'New name',
      });

      expect(result.name).toBe('New name');
    });
  });

  describe('archive', () => {
    it('rejects a MANAGER trying to archive (OWNER only)', async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.property.findFirst.mockResolvedValue({
        id: 'prop-1',
        organizationId: 'org-1',
      });
      memberships.getActiveMembership.mockResolvedValue({ role: 'MANAGER' });
      memberships.assertRole.mockImplementation((_user, membership) => {
        if (membership?.role !== 'OWNER') {
          throw Object.assign(new Error('forbidden'), {
            code: ErrorCode.INSUFFICIENT_ROLE,
          });
        }
      });

      await expect(
        service.archive(buildUser(), 'prop-1'),
      ).rejects.toMatchObject({
        code: ErrorCode.INSUFFICIENT_ROLE,
      });
      expect(prisma.property.update).not.toHaveBeenCalled();
    });

    it('allows an OWNER to archive, setting status to ARCHIVED (never a hard delete)', async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.property.findFirst.mockResolvedValue({
        id: 'prop-1',
        organizationId: 'org-1',
      });
      memberships.getActiveMembership.mockResolvedValue({ role: 'OWNER' });
      prisma.property.update.mockResolvedValue({
        id: 'prop-1',
        ...createDto,
        propertyType: 'PG',
        status: 'ARCHIVED',
        createdAt: new Date(),
      });

      const result = await service.archive(buildUser(), 'prop-1');

      expect(result.status).toBe('ARCHIVED');
      expect(prisma.property.update).toHaveBeenCalledWith({
        where: { id: 'prop-1' },
        data: { status: 'ARCHIVED' },
      });
    });
  });

  describe('findAccessible (list)', () => {
    it("scopes the list to the caller's active organizations when no filter is given", async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue(['org-1']);
      prisma.property.findMany.mockResolvedValue([]);

      await service.findAccessible(buildUser());

      expect(prisma.property.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { organizationId: { in: ['org-1'] } },
        }),
      );
    });

    it('returns an empty list without querying when the caller has no memberships', async () => {
      memberships.listActiveOrganizationIds.mockResolvedValue([]);

      const result = await service.findAccessible(buildUser());

      expect(result).toEqual([]);
      expect(prisma.property.findMany).not.toHaveBeenCalled();
    });

    it('checks access before filtering by an explicit organizationId', async () => {
      memberships.assertOrganizationAccess.mockRejectedValue(
        Object.assign(new Error('not found'), {
          code: ErrorCode.ORGANIZATION_NOT_FOUND,
        }),
      );

      await expect(
        service.findAccessible(buildUser(), 'org-not-mine'),
      ).rejects.toMatchObject({ code: ErrorCode.ORGANIZATION_NOT_FOUND });
      expect(prisma.property.findMany).not.toHaveBeenCalled();
    });
  });
});
