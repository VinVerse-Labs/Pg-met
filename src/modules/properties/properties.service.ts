import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { MembershipRole, Property } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { PropertyResponseDto } from './dto/property-response.dto';

// Roles allowed to create/update a property's operational details. STAFF
// gets read-only access (see findAccessiblePropertyRow - no role filter on
// reads beyond "is an active member"). MANAGER is included here as a
// deliberate Phase 2 decision: managers routinely handle day-to-day setup
// (creating a new branch, correcting an address) on the owner's behalf.
// Archiving is a strictly more destructive action and is OWNER-only (see
// `archive` below) - "can create/edit" does not imply "can archive".
const CREATE_UPDATE_ROLES = ['OWNER', 'MANAGER'] as const;

@Injectable()
export class PropertiesService {
  private readonly logger = new Logger(PropertiesService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
  ) {}

  // The client-supplied `dto.organizationId` names the target organization,
  // but authorization comes entirely from assertOrganizationAccess/assertRole
  // re-deriving the caller's real membership for that id server-side - the
  // field is data, never a credential. See spec section 9.
  async create(
    user: AuthenticatedUser,
    dto: CreatePropertyDto,
  ): Promise<PropertyResponseDto> {
    const { membership } = await this.memberships.assertOrganizationAccess(
      user,
      dto.organizationId,
    );
    this.memberships.assertRole(user, membership, [...CREATE_UPDATE_ROLES]);

    const property = await this.prisma.property.create({
      data: {
        organizationId: dto.organizationId,
        name: dto.name,
        propertyType: dto.propertyType,
        addressLine1: dto.addressLine1,
        addressLine2: dto.addressLine2,
        city: dto.city,
        state: dto.state,
        postalCode: dto.postalCode,
      },
    });

    this.logger.log(
      `PROPERTY_CREATED property=${property.id} org=${dto.organizationId} by=${user.id}`,
    );
    return PropertyResponseDto.fromEntity(property);
  }

  async findAccessible(
    user: AuthenticatedUser,
    organizationId?: string,
  ): Promise<PropertyResponseDto[]> {
    const isSuperAdmin = user.platformRole === 'SUPER_ADMIN';

    if (organizationId) {
      // Reuses the exact same access check as GET /organizations/:id - an
      // organizationId the caller cannot access 404s here too, rather than
      // silently returning an empty list (which would be a second,
      // inconsistent way of saying the same thing).
      await this.memberships.assertOrganizationAccess(user, organizationId);
      const properties = await this.prisma.property.findMany({
        where: { organizationId },
        orderBy: { createdAt: 'desc' },
      });
      return properties.map(PropertyResponseDto.fromEntity);
    }

    if (isSuperAdmin) {
      const properties = await this.prisma.property.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return properties.map(PropertyResponseDto.fromEntity);
    }

    const organizationIds = await this.memberships.listActiveOrganizationIds(
      user.id,
    );
    if (organizationIds.length === 0) {
      return [];
    }
    const properties = await this.prisma.property.findMany({
      where: { organizationId: { in: organizationIds } },
      orderBy: { createdAt: 'desc' },
    });
    return properties.map(PropertyResponseDto.fromEntity);
  }

  async findOne(
    user: AuthenticatedUser,
    propertyId: string,
  ): Promise<PropertyResponseDto> {
    const property = await this.findAccessiblePropertyRow(user, propertyId);
    return PropertyResponseDto.fromEntity(property);
  }

  // Public reuse seam for Phase 3 (RoomsService) and beyond: the exact same
  // org-scoped, BOLA-safe lookup this service uses internally, exposed so
  // a child resource's authorization chain (Room -> Property -> Organization)
  // starts from the same verified Property row instead of re-deriving
  // "is this property accessible" logic in a second place.
  async getAccessiblePropertyOrThrow(
    user: AuthenticatedUser,
    propertyId: string,
  ): Promise<Property> {
    return this.findAccessiblePropertyRow(user, propertyId);
  }

  async update(
    user: AuthenticatedUser,
    propertyId: string,
    dto: UpdatePropertyDto,
  ): Promise<PropertyResponseDto> {
    const property = await this.findAccessiblePropertyRow(user, propertyId);
    await this.assertRoleForProperty(user, property, [...CREATE_UPDATE_ROLES]);

    const updated = await this.prisma.property.update({
      where: { id: propertyId },
      data: dto,
    });
    return PropertyResponseDto.fromEntity(updated);
  }

  // "Delete" is a soft archive, never a hard DELETE FROM - a real property
  // accumulates rooms/beds/tenants/payment history in later phases that
  // must never be destroyed by removing its parent row. OWNER-only:
  // archiving affects every resident and staff member under this property,
  // which is a materially bigger blast radius than editing its address.
  async archive(
    user: AuthenticatedUser,
    propertyId: string,
  ): Promise<PropertyResponseDto> {
    const property = await this.findAccessiblePropertyRow(user, propertyId);
    await this.assertRoleForProperty(user, property, ['OWNER']);

    const archived = await this.prisma.property.update({
      where: { id: propertyId },
      data: { status: 'ARCHIVED' },
    });
    this.logger.log(`PROPERTY_ARCHIVED property=${propertyId} by=${user.id}`);
    return PropertyResponseDto.fromEntity(archived);
  }

  // The BOLA/IDOR defense: a single query scoped by organization
  // membership up front, never "load by id, then check ownership after".
  // A property in an organization the caller doesn't belong to is 404, not
  // 403 - identical to how a property that doesn't exist at all behaves,
  // so a caller cannot use the response to learn that property id belongs
  // to *some* other organization.
  private async findAccessiblePropertyRow(
    user: AuthenticatedUser,
    propertyId: string,
  ): Promise<Property> {
    const isSuperAdmin = user.platformRole === 'SUPER_ADMIN';
    const where = isSuperAdmin
      ? { id: propertyId }
      : {
          id: propertyId,
          organizationId: {
            in: await this.memberships.listActiveOrganizationIds(user.id),
          },
        };

    const property = await this.prisma.property.findFirst({ where });
    if (!property) {
      throw new AppException(
        ErrorCode.PROPERTY_NOT_FOUND,
        'Property not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return property;
  }

  private async assertRoleForProperty(
    user: AuthenticatedUser,
    property: Property,
    allowedRoles: MembershipRole[],
  ): Promise<void> {
    if (user.platformRole === 'SUPER_ADMIN') {
      return;
    }
    // findAccessiblePropertyRow already proved the caller has an active
    // membership in property.organizationId, so this lookup cannot be
    // null in practice - re-fetched (rather than threaded through) to keep
    // this a single well-tested chokepoint for "what's my role here".
    const membership = await this.memberships.getActiveMembership(
      user.id,
      property.organizationId,
    );
    this.memberships.assertRole(user, membership, allowedRoles);
  }
}
