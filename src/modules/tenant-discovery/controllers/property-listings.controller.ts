import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { PropertyListingsService } from '../services/property-listings.service';
import { UpsertListingDto } from '../dto/create-listing.dto';
import { ListingResponseDto } from '../dto/listing-response.dto';

@ApiTags('tenant-discovery: listings')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('properties/:propertyId/listing')
export class PropertyListingsController {
  constructor(private readonly listings: PropertyListingsService) {}

  @Get()
  @ApiOperation({ summary: 'Get (or lazily create) this property’s listing.' })
  @ApiResponse({ status: 200, type: ListingResponseDto })
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
  ): Promise<ListingResponseDto> {
    return this.listings.getOrCreate(user, propertyId);
  }

  @Post()
  @ApiOperation({ summary: 'Create or fully upsert this property’s listing.' })
  @ApiResponse({ status: 201, type: ListingResponseDto })
  async upsert(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Body() dto: UpsertListingDto,
  ): Promise<ListingResponseDto> {
    return this.listings.upsert(user, propertyId, dto);
  }

  @Patch()
  @ApiOperation({ summary: 'Partially update this property’s listing.' })
  @ApiResponse({ status: 200, type: ListingResponseDto })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Body() dto: UpsertListingDto,
  ): Promise<ListingResponseDto> {
    return this.listings.upsert(user, propertyId, dto);
  }

  @Post('publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Publish this listing. 400 LISTING_INCOMPLETE unless title/description/city/locality are all set.',
  })
  @ApiResponse({ status: 200, type: ListingResponseDto })
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
  ): Promise<ListingResponseDto> {
    return this.listings.publish(user, propertyId);
  }

  @Post('unpublish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Unpublish this listing.' })
  @ApiResponse({ status: 200, type: ListingResponseDto })
  async unpublish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
  ): Promise<ListingResponseDto> {
    return this.listings.unpublish(user, propertyId);
  }
}
