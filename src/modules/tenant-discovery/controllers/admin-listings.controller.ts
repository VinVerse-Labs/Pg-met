import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { PlatformAdminGuard } from '../../platform-admin/guards/platform-admin.guard';
import { AdminListingsService } from '../services/admin-listings.service';
import { ListingResponseDto } from '../dto/listing-response.dto';

// Super Admin listing moderation. Kept separate from the read-only
// AdminDiscoveryController: these are the only platform-admin *writes* in
// tenant discovery, limited to publish/unpublish (never content edits),
// and each one is audit-logged by AdminListingsService.
@ApiTags('platform-admin: listings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/properties/:propertyId/listing')
export class AdminListingsController {
  constructor(private readonly adminListings: AdminListingsService) {}

  @Get()
  @ApiOperation({
    summary:
      "Get one property's listing (read-only; never creates one). SUPER_ADMIN only.",
  })
  @ApiResponse({ status: 200, type: ListingResponseDto })
  @ApiResponse({ status: 404, description: 'LISTING_NOT_FOUND' })
  async getOne(
    @Param('propertyId') propertyId: string,
  ): Promise<ListingResponseDto> {
    return this.adminListings.getForProperty(propertyId);
  }

  @Post('publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Publish a listing on the owner’s behalf (same completeness rule). Audit-logged. SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 200, type: ListingResponseDto })
  async publish(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
  ): Promise<ListingResponseDto> {
    return this.adminListings.publish(admin, propertyId);
  }

  @Post('unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Take a listing off public discovery. Audit-logged. SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 200, type: ListingResponseDto })
  async unpublish(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
  ): Promise<ListingResponseDto> {
    return this.adminListings.unpublish(admin, propertyId);
  }
}
