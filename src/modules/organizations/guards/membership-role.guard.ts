import { CanActivate, ExecutionContext, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { MembershipRole, OrganizationMembership } from '@prisma/client';
import { Request } from 'express';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { MembershipsService } from '../../memberships/memberships.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

type RequestWithOrgContext = Request & {
  user: AuthenticatedUser;
  membership: OrganizationMembership | null;
};

// Reads the @Roles(...) metadata a route declares and enforces it against
// req.membership (set by OrganizationMembershipGuard, which MUST run
// first). A route with no @Roles(...) is allowed for any active member -
// this guard only restricts, it never grants access on its own.
@Injectable()
export class MembershipRoleGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly memberships: MembershipsService,
  ) {}

  canActivate(context: ExecutionContext): boolean {
    const requiredRoles = this.reflector.getAllAndOverride<MembershipRole[]>(
      ROLES_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!requiredRoles || requiredRoles.length === 0) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithOrgContext>();
    this.memberships.assertRole(
      request.user,
      request.membership,
      requiredRoles,
    );
    return true;
  }
}
