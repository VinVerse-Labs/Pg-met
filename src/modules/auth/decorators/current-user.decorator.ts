import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import { Request } from 'express';
import { AuthenticatedUser } from '../strategies/jwt.strategy';

// Reads the value JwtStrategy.validate() attached to the request - never
// the raw JWT payload - so a handler using @CurrentUser() always gets the
// same safe, database-fresh shape (no passwordHash, no token fields).
export const CurrentUser = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): AuthenticatedUser => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return request.user as AuthenticatedUser;
  },
);
