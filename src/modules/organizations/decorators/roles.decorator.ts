import { SetMetadata } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';

export const ROLES_KEY = 'requiredMembershipRoles';

// Declares which OrganizationMembership roles may call a route. Must be
// combined with @UseGuards(JwtAuthGuard, OrganizationMembershipGuard,
// MembershipRoleGuard) - the metadata alone enforces nothing; it's the
// guard that reads it. Centralizing role checks in one guard (rather than
// `if (membership.role !== 'OWNER') throw ...` scattered across
// controllers) is what makes the permission model auditable in one place.
export const Roles = (
  ...roles: MembershipRole[]
): MethodDecorator & ClassDecorator => SetMetadata(ROLES_KEY, roles);
