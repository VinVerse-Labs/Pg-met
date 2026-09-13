import { HttpStatus, Injectable } from '@nestjs/common';
import {
  MembershipRole,
  Organization,
  OrganizationMembership,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';

export interface OrganizationAccessContext {
  organization: Organization;
  // null only for a SUPER_ADMIN acting without being a member themselves -
  // callers must treat a null membership as "platform override", never as
  // "has every role".
  membership: OrganizationMembership | null;
}

// The single place every organization/property authorization decision goes
// through - guards and services both call into this, so "who can do what"
// is never re-implemented ad hoc in a controller. See README's "Phase 2:
// multi-tenant authorization architecture" for the full request flow this
// implements (JWT -> current user -> membership check -> role check ->
// resource ownership check -> DB operation).
@Injectable()
export class MembershipsService {
  constructor(private readonly prisma: PrismaService) {}

  async getActiveMembership(
    userId: string,
    organizationId: string,
  ): Promise<OrganizationMembership | null> {
    return this.prisma.organizationMembership.findFirst({
      where: { userId, organizationId, status: 'ACTIVE' },
    });
  }

  // Used to scope any "list/find resources this user can see" query to
  // exactly their active organizations - e.g.
  // `prisma.property.findMany({ where: { organizationId: { in: ... } } })`.
  // Deliberately returns an array of ids rather than an ORM query fragment
  // so callers stay explicit about what they're filtering on (see
  // PropertiesService for why "explicit scoping in the query" beats
  // "load then check ownership").
  async listActiveOrganizationIds(userId: string): Promise<string[]> {
    const rows = await this.prisma.organizationMembership.findMany({
      where: { userId, status: 'ACTIVE' },
      select: { organizationId: true },
    });
    return rows.map((row) => row.organizationId);
  }

  // The core tenant-isolation check: does `user` have any access at all to
  // `organizationId`? Returns 404 ORGANIZATION_NOT_FOUND uniformly whether
  // the organization does not exist, or it exists but the user has never
  // been (or is no longer) an active member - deliberately not
  // distinguishable from the outside, so a non-member cannot use this
  // endpoint to probe which organization ids are real.
  //
  // A SUPER_ADMIN bypasses the membership requirement entirely (platform
  // operators are not organization members), but is still blocked by
  // organization suspension exactly like anyone else - suspension is a
  // property of the organization, not of a specific member's access.
  async assertOrganizationAccess(
    user: AuthenticatedUser,
    organizationId: string,
  ): Promise<OrganizationAccessContext> {
    const organization = await this.prisma.organization.findUnique({
      where: { id: organizationId },
    });
    const isSuperAdmin = user.platformRole === 'SUPER_ADMIN';

    if (!organization) {
      throw this.organizationNotFound();
    }

    const membership = isSuperAdmin
      ? null
      : await this.getActiveMembership(user.id, organizationId);

    if (!isSuperAdmin && !membership) {
      throw this.organizationNotFound();
    }

    if (organization.status === 'SUSPENDED') {
      throw new AppException(
        ErrorCode.ORGANIZATION_SUSPENDED,
        'This organization has been suspended.',
        HttpStatus.FORBIDDEN,
      );
    }

    return { organization, membership };
  }

  // Call after assertOrganizationAccess to enforce a role requirement for
  // a specific action. Kept as a separate step (rather than baked into
  // assertOrganizationAccess) because many operations only need "is a
  // member" (e.g. viewing), while only some need "is a member AND holds
  // one of these roles" (e.g. creating a property).
  assertRole(
    user: AuthenticatedUser,
    membership: OrganizationMembership | null,
    allowedRoles: MembershipRole[],
  ): void {
    if (user.platformRole === 'SUPER_ADMIN') {
      return;
    }
    if (!membership || !allowedRoles.includes(membership.role)) {
      throw new AppException(
        ErrorCode.INSUFFICIENT_ROLE,
        'You do not have permission to perform this action.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private organizationNotFound(): AppException {
    return new AppException(
      ErrorCode.ORGANIZATION_NOT_FOUND,
      'Organization not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}
