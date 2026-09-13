import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Request } from 'express';
import { Organization, OrganizationMembership } from '@prisma/client';
import { MembershipsService } from '../../memberships/memberships.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

type RequestWithOrgContext = Request & {
  user: AuthenticatedUser;
  organization: Organization;
  membership: OrganizationMembership | null;
};

// Route-param-based tenant scoping: only fits routes shaped like
// `/organizations/:id`, where the organization id IS the resource id in
// the URL. Loads the organization + the caller's membership in it (via
// MembershipsService.assertOrganizationAccess - 404s if either doesn't
// exist, so existence of an organization the caller isn't a member of is
// never revealed) and attaches both to the request for the handler /
// MembershipRoleGuard to use.
//
// Must run after JwtAuthGuard (needs req.user) and before
// MembershipRoleGuard (needs req.membership) - see
// OrganizationsController's @UseGuards ordering.
//
// Properties do NOT use this guard: a property's organization is only
// known after loading the property row itself, so that authorization
// happens inside PropertiesService instead (see its docs).
@Injectable()
export class OrganizationMembershipGuard implements CanActivate {
  constructor(private readonly memberships: MembershipsService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithOrgContext>();
    const organizationId = String(request.params.id);

    const { organization, membership } =
      await this.memberships.assertOrganizationAccess(
        request.user,
        organizationId,
      );

    request.organization = organization;
    request.membership = membership;
    return true;
  }
}
