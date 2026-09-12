import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { createHash, randomUUID } from 'crypto';
import { JwtConfig } from '../../../config/configuration';

export interface AccessTokenPayload {
  sub: string;
}

export interface RefreshTokenPayload {
  sub: string;
  jti: string;
}

export interface SignedRefreshToken {
  token: string;
  jti: string;
  expiresAt: Date;
}

// The only place a JWT is signed or verified, and the only place a refresh
// token is hashed for storage. Kept separate from AuthService so the
// "how tokens are made" concern doesn't get tangled with "what a login
// attempt should do".
//
// A single JwtService instance handles both access and refresh tokens -
// the secret and expiry are passed explicitly on every sign/verify call
// rather than relying on one global default, since the two token types
// intentionally use different secrets (a leaked access-token secret must
// not be enough to forge refresh tokens, and vice versa).
@Injectable()
export class TokenService {
  private readonly jwtConfig: JwtConfig;

  constructor(
    private readonly jwtService: JwtService,
    private readonly configService: ConfigService,
  ) {
    this.jwtConfig = this.configService.get<JwtConfig>('jwt')!;
  }

  // Payload is intentionally minimal (`sub` only) - see project instructions:
  // no password, KYC data, room/bed/property info, or other sensitive
  // profile fields ever belong in a JWT. Anything a protected route needs
  // beyond the user id is loaded fresh from the database.
  signAccessToken(userId: string): { token: string; expiresIn: number } {
    const token = this.jwtService.sign(
      { sub: userId } satisfies AccessTokenPayload,
      {
        secret: this.jwtConfig.accessSecret,
        expiresIn: this.jwtConfig.accessExpiresIn,
      },
    );
    const decoded = this.jwtService.decode(token) as {
      exp: number;
      iat: number;
    };
    return { token, expiresIn: decoded.exp - decoded.iat };
  }

  // `jti` gives every refresh token unique entropy even if issued for the
  // same user within the same second, so its SHA-256 hash is always unique
  // (the tokenHash column is `@unique`) and each row unambiguously
  // identifies one issued token.
  signRefreshToken(userId: string): SignedRefreshToken {
    const jti = randomUUID();
    const token = this.jwtService.sign(
      { sub: userId, jti } satisfies RefreshTokenPayload,
      {
        secret: this.jwtConfig.refreshSecret,
        expiresIn: this.jwtConfig.refreshExpiresIn,
      },
    );
    const decoded = this.jwtService.decode(token) as { exp: number };
    return { token, jti, expiresAt: new Date(decoded.exp * 1000) };
  }

  // Throws JsonWebTokenError/TokenExpiredError (from the `jsonwebtoken`
  // library) on an invalid/expired token - callers distinguish those to
  // return TOKEN_INVALID vs TOKEN_EXPIRED.
  async verifyRefreshToken(token: string): Promise<RefreshTokenPayload> {
    return this.jwtService.verifyAsync<RefreshTokenPayload>(token, {
      secret: this.jwtConfig.refreshSecret,
    });
  }

  // Only this hash is ever persisted - never the raw refresh token. SHA-256
  // (not argon2/bcrypt) is deliberate: refresh tokens already carry
  // cryptographic-strength random entropy via `jti`, so unlike a
  // human-chosen password there's no offline dictionary-attack risk to
  // defend against with a slow hash; a fast, deterministic hash is exactly
  // what's needed to look the row up by exact match.
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
