import {
  CanActivate,
  ExecutionContext,
  HttpStatus,
  Injectable,
} from '@nestjs/common';
import { Request } from 'express';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';

// The one and only Super Admin authorization check (spec: "authenticated
// user -> platform role -> SUPER_ADMIN. Only then should the request
// reach Super Admin endpoints. Do NOT check membership.role === OWNER").
// Reads `AuthenticatedUser.platformRole`, already present on every
// request since Phase 1 - this guard adds no new identity concept, only
// a new place that checks the existing one. Always applied after
// JwtAuthGuard (see PlatformAdminController base classes), never in place
// of it - an unauthenticated request never reaches this check at all.
@Injectable()
export class PlatformAdminGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const user = request.user as AuthenticatedUser;

    if (user?.platformRole !== 'SUPER_ADMIN') {
      // 404, not 403 - the existence of the entire platform-admin API
      // surface is not confirmed to a non-admin caller, the same
      // "hide resource existence" principle every cross-tenant check in
      // this project uses (see MembershipsService.assertOrganizationAccess).
      throw new AppException(
        ErrorCode.PLATFORM_ADMIN_ACCESS_DENIED,
        'Not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return true;
  }
}
