import { Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
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
