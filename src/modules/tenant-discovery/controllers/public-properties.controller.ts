import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { OptionalJwtAuthGuard } from '../guards/optional-jwt-auth.guard';
import { PublicDiscoveryService } from '../services/public-discovery.service';
import { TenantApplicationsService } from '../services/tenant-applications.service';
import { ListPublicPropertiesQueryDto } from '../dto/list-public-properties.query.dto';
import { SubmitApplicationDto } from '../dto/submit-application.dto';
import { ApplicationResponseDto } from '../dto/application-response.dto';

// Deliberately unguarded (no JwtAuthGuard) - this is the first genuinely
// public surface in this codebase. The route path itself
// (`/public/properties`) is the security boundary; every method still
// re-filters at the query level for PUBLISHED + Property ACTIVE +
// Organization not SUSPENDED (see PublicDiscoveryService) rather than
// relying on the absence of a guard alone.
@ApiTags('public: property discovery')
@Controller('public/properties')
export class PublicPropertiesController {
  constructor(
    private readonly discovery: PublicDiscoveryService,
    private readonly applications: TenantApplicationsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Search published, active property listings.' })
  async list(@Query() query: ListPublicPropertiesQueryDto) {
    return this.discovery.list(query);
  }

  @Get(':propertyId')
  @ApiOperation({
    summary:
      'Full public detail for one published listing, including amenities and a room-type/availability breakdown.',
  })
  async getOne(@Param('propertyId') propertyId: string) {
    return this.discovery.getOne(propertyId);
  }

  // OptionalJwtAuthGuard: a guest applicant (no Authorization header) is
  // let through with no user; an authenticated caller is auto-linked -
  // never a distinct code path, just an optional applicantUserId.
  @Post(':propertyId/applications')
  @UseGuards(OptionalJwtAuthGuard)
  @ApiOperation({
    summary:
      'Submit an application (guest or authenticated). Fails 409 APPLICATION_ALREADY_EXISTS if an active application already exists for this applicant/property.',
  })
  @ApiResponse({ status: 201, type: ApplicationResponseDto })
  async submitApplication(
    @CurrentUser() user: AuthenticatedUser | undefined,
    @Param('propertyId') propertyId: string,
    @Body() dto: SubmitApplicationDto,
  ): Promise<ApplicationResponseDto> {
    return this.applications.create(propertyId, dto, user?.id ?? null);
  }
}
