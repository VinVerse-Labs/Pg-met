import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { OrganizationMembership } from '@prisma/client';
import { Request } from 'express';

// null when the caller is a SUPER_ADMIN acting without being a member of
// this organization - handlers that need the caller's role must handle
// that case explicitly rather than assuming a membership always exists.
export const CurrentMembership = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): OrganizationMembership | null => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return (request as Request & { membership: OrganizationMembership | null })
      .membership;
  },
);
