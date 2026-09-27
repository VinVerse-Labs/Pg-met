import { Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { TenantsService } from './tenants.service';
import { TenantResponseDto } from './dto/tenant-response.dto';
import { TenantLookupResponseDto } from './dto/tenant-lookup-response.dto';
import { TenantLookupQueryDto } from './dto/tenant-lookup.query.dto';

@ApiTags('tenants')
@ApiBearerAuth()
@Controller('tenants')
@UseGuards(JwtAuthGuard)
export class TenantsController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a tenant profile for the authenticated user. userId is always the caller - there is no way to create a tenant profile for someone else.',
  })
  @ApiResponse({ status: 201, type: TenantResponseDto })
  @ApiResponse({
    status: 409,
    description: 'This user already has a tenant profile.',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TenantResponseDto> {
    return this.tenantsService.createForSelf(user);
  }

  // Declared before `:id` so "lookup" is never captured as a tenant id.
  @Get('lookup')
  @ApiOperation({
    summary:
      'Resolve a tenant code (TN-XXXX-XXXX) to a tenantId + account name, for check-in. OWNER/MANAGER of any organization only; 404 otherwise.',
  })
  @ApiResponse({ status: 200, type: TenantLookupResponseDto })
  @ApiResponse({ status: 404 })
  @ApiResponse({ status: 409, description: 'TENANT_CODE_AMBIGUOUS' })
  async lookup(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: TenantLookupQueryDto,
  ): Promise<TenantLookupResponseDto> {
    return this.tenantsService.lookupByCode(user, query.code);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      "Get a tenant profile. Visible to the tenant's own user, or any active member of an organization where this tenant has a residency. 404 otherwise.",
  })
  @ApiResponse({ status: 200, type: TenantResponseDto })
  @ApiResponse({ status: 404 })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<TenantResponseDto> {
    return this.tenantsService.findOne(user, id);
  }
}

// The caller's own tenant profile - how a tenant sees the code to share with
// a property team. Kept under /me like every other self-scoped resource.
@ApiTags('tenants')
@ApiBearerAuth()
@Controller('me/tenant')
@UseGuards(JwtAuthGuard)
export class MyTenantController {
  constructor(private readonly tenantsService: TenantsService) {}

  @Get()
  @ApiOperation({
    summary:
      "The caller's own tenant profile (id + short code). 404 TENANT_NOT_FOUND if they don't have one yet - create it with POST /tenants.",
  })
  @ApiResponse({ status: 200, type: TenantResponseDto })
  @ApiResponse({ status: 404 })
  async findMine(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<TenantResponseDto> {
    return this.tenantsService.findMine(user);
  }
}
