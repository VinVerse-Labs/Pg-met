import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { PlatformAdminService } from './platform-admin.service';
import { AdminOrganizationsQueryDto } from './dto/admin-organizations-query.dto';
import { AdminOwnersQueryDto } from './dto/admin-owners-query.dto';
import { AdminPropertiesQueryDto } from './dto/admin-properties-query.dto';
import { AdminSubscriptionsQueryDto } from './dto/admin-subscriptions-query.dto';

// Every controller in this module requires both a valid JWT *and*
// PlatformRole.SUPER_ADMIN (spec: "authenticated user -> platform role ->
// SUPER_ADMIN"). A non-admin caller - including an OWNER, however senior
// in their own organization - receives 404, not 403, hiding the very
// existence of this API surface (see PlatformAdminGuard's doc comment).
@ApiTags('platform-admin: organizations')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/organizations')
export class AdminOrganizationsController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'List every organization on the platform. SUPER_ADMIN only.',
  })
  async findAll(@Query() query: AdminOrganizationsQueryDto) {
    return this.platformAdminService.findOrganizations(query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Full platform-admin detail view of one organization. SUPER_ADMIN only.',
  })
  async findOne(@Param('id') id: string) {
    return this.platformAdminService.findOrganizationDetail(id);
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Platform-level suspension (distinct from subscription suspension - see README’s "Phase 8" section). Blocks normal access via the existing MembershipsService chokepoint. SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 409, description: 'Already suspended.' })
  async suspend(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ success: true }> {
    await this.platformAdminService.suspendOrganization(admin, id);
    return { success: true };
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reverse a platform-level suspension. SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 409, description: 'Already active.' })
  async activate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<{ success: true }> {
    await this.platformAdminService.activateOrganization(admin, id);
    return { success: true };
  }
}

@ApiTags('platform-admin: owners')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/owners')
export class AdminOwnersController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Get()
  @ApiOperation({
    summary:
      'List platform owners, with organization/property/subscription summaries. SUPER_ADMIN only.',
  })
  async findAll(@Query() query: AdminOwnersQueryDto) {
    return this.platformAdminService.findOwners(query);
  }

  @Get(':userId')
  @ApiOperation({
    summary: 'One owner’s full organization portfolio. SUPER_ADMIN only.',
  })
  async findOne(@Param('userId') userId: string) {
    return this.platformAdminService.findOwnerDetail(userId);
  }
}

@ApiTags('platform-admin: properties')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/properties')
export class AdminPropertiesController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'List every property on the platform. SUPER_ADMIN only.',
  })
  async findAll(@Query() query: AdminPropertiesQueryDto) {
    return this.platformAdminService.findProperties(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One property’s platform-admin detail view. SUPER_ADMIN only.',
  })
  async findOne(@Param('id') id: string) {
    return this.platformAdminService.findPropertyDetail(id);
  }
}

@ApiTags('platform-admin: subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/subscriptions')
export class AdminSubscriptionsController {
  constructor(private readonly platformAdminService: PlatformAdminService) {}

  @Get()
  @ApiOperation({
    summary: 'List every organization’s SaaS subscription. SUPER_ADMIN only.',
  })
  async findAll(@Query() query: AdminSubscriptionsQueryDto) {
    return this.platformAdminService.findSubscriptions(query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'One subscription’s platform-admin detail view. SUPER_ADMIN only.',
  })
  async findOne(@Param('id') id: string) {
    return this.platformAdminService.findSubscriptionDetail(id);
  }
}
