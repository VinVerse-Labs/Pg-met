import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Request } from 'express';
import { AuthService } from '../services/auth.service';
import { RegisterDto } from '../dto/register.dto';
import { LoginDto } from '../dto/login.dto';
import { RefreshDto } from '../dto/refresh.dto';
import { LogoutDto } from '../dto/logout.dto';
import { AuthResponseDto, AuthTokensDto } from '../dto/auth-response.dto';
import { JwtAuthGuard } from '../guards/jwt-auth.guard';
import { CurrentUser } from '../decorators/current-user.decorator';
import { AuthenticatedUser } from '../strategies/jwt.strategy';
import { UserResponseDto } from '../../users/dto/user-response.dto';
import { SessionMeta } from '../auth.types';

// Stricter rate limit than the global default (100/min - see AppModule) for
// the two endpoints that are the actual target of brute-force/credential-
// stuffing and refresh-token-guessing attempts.
const AUTH_THROTTLE = { default: { limit: 10, ttl: 60_000 } };

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Post('register')
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({
    summary:
      'Create a new platform user account. Always creates an ordinary user - there is no way to request SUPER_ADMIN or an organization role through this endpoint.',
  })
  @ApiResponse({ status: 201, type: AuthResponseDto })
  @ApiResponse({ status: 409, description: 'Email or phone already in use.' })
  async register(
    @Body() dto: RegisterDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    return this.authService.register(dto, this.sessionMeta(req));
  }

  @Post('login')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({ summary: 'Authenticate with email/phone + password.' })
  @ApiResponse({ status: 200, type: AuthResponseDto })
  @ApiResponse({
    status: 401,
    description:
      'Incorrect credentials (does not reveal whether the account exists).',
  })
  @ApiResponse({
    status: 403,
    description: 'Account is suspended or inactive.',
  })
  async login(
    @Body() dto: LoginDto,
    @Req() req: Request,
  ): Promise<AuthResponseDto> {
    return this.authService.login(dto, this.sessionMeta(req));
  }

  @Post('refresh')
  @HttpCode(HttpStatus.OK)
  @Throttle(AUTH_THROTTLE)
  @ApiOperation({
    summary:
      'Exchange a refresh token for a new access + refresh token pair (rotation). The presented refresh token is revoked as part of this call.',
  })
  @ApiResponse({ status: 200, type: AuthTokensDto })
  @ApiResponse({
    status: 401,
    description: 'Refresh token is invalid, expired, or already used.',
  })
  async refresh(
    @Body() dto: RefreshDto,
    @Req() req: Request,
  ): Promise<AuthTokensDto> {
    return this.authService.refresh(dto, this.sessionMeta(req));
  }

  @Post('logout')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Revoke a single refresh token/session. Other devices/sessions for the same user are unaffected.',
  })
  @ApiResponse({ status: 200 })
  async logout(@Body() dto: LogoutDto): Promise<{ message: string }> {
    await this.authService.logout(dto);
    return { message: 'Logged out.' };
  }

  @Get('me')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: "Return the authenticated user's safe profile." })
  @ApiResponse({ status: 200, type: UserResponseDto })
  @ApiResponse({ status: 401 })
  me(@CurrentUser() user: AuthenticatedUser): UserResponseDto {
    return UserResponseDto.fromEntity(user);
  }

  private sessionMeta(req: Request): SessionMeta {
    return {
      userAgent: req.headers['user-agent'],
      ipAddress: req.ip,
    };
  }
}
