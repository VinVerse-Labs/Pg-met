import { Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { PlatformRole, UserStatus } from '@prisma/client';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtConfig } from '../../../config/configuration';
import { UsersService } from '../../users/users.service';
import { AccessTokenPayload } from '../services/token.service';

// The internal, request-attached shape of "who is making this call" - not
// to be confused with UserResponseDto (the public /auth/me shape), which
// deliberately omits platformRole. platformRole is included here because
// Phase 2 authorization (SUPER_ADMIN bypass) needs it on every request;
// exposing it publicly is a separate decision this type does not make.
export interface AuthenticatedUser {
  id: string;
  name: string;
  email: string | null;
  phone: string | null;
  status: UserStatus;
  platformRole: PlatformRole;
}

// Runs on every request protected by JwtAuthGuard. Deliberately re-reads the
// user from the database on every call rather than trusting the JWT payload
// alone - this is what makes "account suspended after the token was
// issued" (edge case) take effect within one access-token lifetime (at most
// JWT_ACCESS_EXPIRES_IN, a few minutes) instead of up to 7 days (the
// refresh token's lifetime) later.
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(
    configService: ConfigService,
    private readonly usersService: UsersService,
  ) {
    const jwtConfig = configService.get<JwtConfig>('jwt')!;
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: jwtConfig.accessSecret,
    });
  }

  async validate(payload: AccessTokenPayload): Promise<AuthenticatedUser> {
    const user = await this.usersService.findById(payload.sub);
    if (!user || user.status !== 'ACTIVE') {
      throw new UnauthorizedException();
    }
    return {
      id: user.id,
      name: user.name,
      email: user.email,
      phone: user.phone,
      status: user.status,
      platformRole: user.platformRole,
    };
  }
}
