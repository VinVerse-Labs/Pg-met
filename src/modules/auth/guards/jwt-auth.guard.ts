import { HttpStatus, Injectable } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';

// Thin wrapper around Passport's AuthGuard('jwt') that translates its
// generic failures into the project's standard AppException/ErrorCode
// shape, so a client can branch on `error.code` (TOKEN_EXPIRED vs
// TOKEN_INVALID vs UNAUTHORIZED) instead of a single undifferentiated 401.
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  handleRequest<TUser = unknown>(
    err: unknown,
    user: TUser,
    info: unknown,
  ): TUser {
    if (err || !user) {
      const name = (info as { name?: string } | undefined)?.name;
      if (name === 'TokenExpiredError') {
        throw new AppException(
          ErrorCode.TOKEN_EXPIRED,
          'Access token has expired.',
          HttpStatus.UNAUTHORIZED,
        );
      }
      if (name === 'JsonWebTokenError') {
        throw new AppException(
          ErrorCode.TOKEN_INVALID,
          'Access token is invalid.',
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'Authentication is required.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    return user;
  }
}
