import { Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';

// Used only on the single public "submit an application" endpoint (spec:
// "if the request is authenticated, auto-link applicantUserId"). Unlike
// JwtAuthGuard, a missing/invalid token is never an error here - the
// request is allowed through either way, with `request.user` populated
// only when a valid token was actually presented. The route itself (under
// `/public/*`) is the real security boundary; this guard only ever adds
// identity, it never removes access.
@Injectable()
export class OptionalJwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(
    _err: unknown,
    user: TUser,
  ): TUser | undefined {
    return user || undefined;
  }
}
