import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { User } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { UsersService } from '../../users/users.service';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshDto } from '../dto/refresh.dto';
import { LogoutDto } from '../dto/logout.dto';
import { AuthResponseDto, AuthTokensDto } from '../dto/auth-response.dto';
import { SessionMeta } from '../auth.types';
import { PasswordService } from './password.service';
import { TokenService } from './token.service';

// Owns the full lifecycle of a login session: credential verification,
// account-status checks, token issuance, refresh rotation (with reuse
// detection), and logout. Deliberately does NOT own authorization (what a
// user can do once authenticated) - that is Phase 2's OrganizationMembership
// concern, not this service's.
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly usersService: UsersService,
    private readonly passwordService: PasswordService,
    private readonly tokenService: TokenService,
  ) {}

  // Public registration can only ever produce an ordinary platform user -
  // RegisterDto has no field for platformRole/role/organization, so there is
  // no input for a client to smuggle SUPER_ADMIN (or any org role) through.
  // Auto-issuing tokens on register (rather than forcing a separate login
  // call) is a deliberate UX choice for a mobile-first product; it is not
  // required by anything else in this module and can be changed without
  // touching login/refresh/logout.
  async register(
    dto: RegisterDto,
    meta: SessionMeta,
  ): Promise<AuthResponseDto> {
    if (!dto.email && !dto.phone) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'Either email or phone is required.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const passwordHash = await this.passwordService.hash(dto.password);
    // A duplicate email/phone raises Prisma's P2002, which
    // AllExceptionsFilter already turns into 409 CONFLICT - no try/catch
    // needed here. The database (unique constraint), not an application
    // pre-check, is what actually prevents two concurrent registrations
    // from creating duplicate users.
    const user = await this.usersService.create({
      name: dto.name,
      email: dto.email,
      phone: dto.phone,
      passwordHash,
    });

    this.logger.log(`AUTH_REGISTER user=${user.id}`);
    const tokens = await this.issueTokens(user, meta);
    return { user: UserResponseDto.fromEntity(user), tokens };
  }

  async login(dto: LoginDto, meta: SessionMeta): Promise<AuthResponseDto> {
    const user = await this.usersService.findByIdentifier(dto.identifier);

    // Same generic failure whether the account does not exist, the user
    // has no password set (an OTP-only account attempting password login),
    // or the password is wrong - never reveal which case applies.
    if (!user || !user.passwordHash) {
      this.logger.warn(
        `LOGIN_FAILURE identifier=${this.redact(dto.identifier)}`,
      );
      throw this.invalidCredentials();
    }

    const passwordValid = await this.passwordService.verify(
      user.passwordHash,
      dto.password,
    );
    if (!passwordValid) {
      this.logger.warn(`LOGIN_FAILURE user=${user.id}`);
      throw this.invalidCredentials();
    }

    // Status is checked only *after* the password has been confirmed
    // correct - telling an already-authenticated caller "your account is
    // suspended" leaks nothing an attacker without the password could use,
    // whereas leaking it before password verification would be an account
    // enumeration/status oracle.
    this.assertActive(user);

    const tokens = await this.issueTokens(user, meta);
    this.logger.log(`LOGIN_SUCCESS user=${user.id}`);
    return { user: UserResponseDto.fromEntity(user), tokens };
  }

  async refresh(dto: RefreshDto, meta: SessionMeta): Promise<AuthTokensDto> {
    const payload = await this.verifyRefreshJwt(dto.refreshToken);
    const tokenHash = this.tokenService.hashToken(dto.refreshToken);

    const existing = await this.prisma.refreshToken.findUnique({
      where: { tokenHash },
    });
    if (!existing) {
      throw new AppException(
        ErrorCode.TOKEN_INVALID,
        'Refresh token is invalid.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (existing.revokedAt) {
      // The presented token was already rotated away (or explicitly logged
      // out) - a legitimate client would only ever hold the *latest* token
      // for a session, so this means either a replay of a stolen token or
      // a bug in the client retrying a stale value. Either way, the safe
      // response is to revoke every other still-active session for this
      // user, forcing every device to re-authenticate.
      await this.revokeAllSessionsForUser(existing.userId);
      this.logger.error(`REFRESH_TOKEN_REUSE_DETECTED user=${existing.userId}`);
      throw new AppException(
        ErrorCode.TOKEN_REVOKED,
        'This refresh token has already been used. All sessions have been revoked for your safety.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    if (existing.expiresAt < new Date()) {
      throw new AppException(
        ErrorCode.TOKEN_EXPIRED,
        'Refresh token has expired.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const user = await this.usersService.findById(payload.sub);
    if (!user) {
      throw new AppException(
        ErrorCode.UNAUTHORIZED,
        'User no longer exists.',
        HttpStatus.UNAUTHORIZED,
      );
    }
    this.assertActive(user);

    const rotated = await this.rotateRefreshToken(existing.id, user.id, meta);
    if (!rotated) {
      // Lost a race to a concurrent refresh request presenting the exact
      // same token - from this caller's point of view that is
      // indistinguishable from reuse of an already-rotated token, so it
      // gets the same response rather than a confusing "conflict" error.
      throw new AppException(
        ErrorCode.TOKEN_REVOKED,
        'This refresh token has already been used.',
        HttpStatus.UNAUTHORIZED,
      );
    }

    const access = this.tokenService.signAccessToken(user.id);
    this.logger.log(`REFRESH_TOKEN_ROTATED user=${user.id}`);
    return {
      accessToken: access.token,
      refreshToken: rotated.token,
      expiresIn: access.expiresIn,
      tokenType: 'Bearer',
    };
  }

  // Logout is intentionally idempotent and silent about whether the token
  // existed/was already revoked (edge case: "already revoked session") -
  // the end state the caller wants ("this token no longer works") is true
  // either way, and a distinct error here would be one more oracle for an
  // attacker probing token validity.
  async logout(dto: LogoutDto): Promise<void> {
    const tokenHash = this.tokenService.hashToken(dto.refreshToken);
    await this.prisma.refreshToken.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    this.logger.log('LOGOUT');
  }

  private async issueTokens(
    user: User,
    meta: SessionMeta,
  ): Promise<AuthTokensDto> {
    const access = this.tokenService.signAccessToken(user.id);
    const refresh = this.tokenService.signRefreshToken(user.id);
    await this.prisma.refreshToken.create({
      data: {
        userId: user.id,
        tokenHash: this.tokenService.hashToken(refresh.token),
        expiresAt: refresh.expiresAt,
        userAgent: meta.userAgent,
        ipAddress: meta.ipAddress,
      },
    });
    return {
      accessToken: access.token,
      refreshToken: refresh.token,
      expiresIn: access.expiresIn,
      tokenType: 'Bearer',
    };
  }

  // The revoke-then-create rotation is wrapped in a single transaction, and
  // the revoke step is a conditional `updateMany` (only rows still
  // `revokedAt: null`) rather than an unconditional update - this is the
  // compare-and-swap that makes concurrent refresh requests for the same
  // token safe: at most one of them can ever see `count === 1` and proceed
  // to mint a replacement.
  private async rotateRefreshToken(
    existingId: string,
    userId: string,
    meta: SessionMeta,
  ): Promise<{ token: string } | null> {
    return this.prisma.$transaction(async (tx) => {
      const now = new Date();
      const revoked = await tx.refreshToken.updateMany({
        where: { id: existingId, revokedAt: null },
        data: { revokedAt: now, lastUsedAt: now },
      });
      if (revoked.count === 0) {
        return null;
      }

      const signed = this.tokenService.signRefreshToken(userId);
      await tx.refreshToken.create({
        data: {
          userId,
          tokenHash: this.tokenService.hashToken(signed.token),
          expiresAt: signed.expiresAt,
          userAgent: meta.userAgent,
          ipAddress: meta.ipAddress,
        },
      });
      return { token: signed.token };
    });
  }

  private async revokeAllSessionsForUser(userId: string): Promise<void> {
    await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  private async verifyRefreshJwt(
    token: string,
  ): Promise<{ sub: string; jti: string }> {
    try {
      return await this.tokenService.verifyRefreshToken(token);
    } catch (error) {
      if ((error as { name?: string }).name === 'TokenExpiredError') {
        throw new AppException(
          ErrorCode.TOKEN_EXPIRED,
          'Refresh token has expired.',
          HttpStatus.UNAUTHORIZED,
        );
      }
      throw new AppException(
        ErrorCode.TOKEN_INVALID,
        'Refresh token is invalid.',
        HttpStatus.UNAUTHORIZED,
      );
    }
  }

  private assertActive(user: User): void {
    if (user.status === 'SUSPENDED') {
      this.logger.warn(`ACCOUNT_SUSPENDED user=${user.id}`);
      throw new AppException(
        ErrorCode.ACCOUNT_SUSPENDED,
        'This account has been suspended.',
        HttpStatus.FORBIDDEN,
      );
    }
    if (user.status === 'INACTIVE') {
      throw new AppException(
        ErrorCode.ACCOUNT_INACTIVE,
        'This account is inactive.',
        HttpStatus.FORBIDDEN,
      );
    }
  }

  private invalidCredentials(): AppException {
    return new AppException(
      ErrorCode.INVALID_CREDENTIALS,
      'Incorrect email/phone or password.',
      HttpStatus.UNAUTHORIZED,
    );
  }

  // Never log a full identifier (it may be a real email/phone) - only
  // enough to spot patterns (e.g. repeated failures for the same local
  // part) without logging PII wholesale.
  private redact(identifier: string): string {
    return identifier.length <= 3
      ? '***'
      : `${identifier.slice(0, 2)}***${identifier.slice(-1)}`;
  }
}
