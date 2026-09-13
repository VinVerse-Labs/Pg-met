import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Organization } from '@prisma/client';
import { Request } from 'express';

// Reads the Organization row OrganizationMembershipGuard already loaded
// and verified access to - never re-fetched, so a controller cannot
// accidentally use an unscoped `organization.id` from somewhere else.
export const CurrentOrganization = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): Organization => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return (request as Request & { organization: Organization }).organization;
  },
);
