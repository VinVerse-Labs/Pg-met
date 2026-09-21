import {
  Body,
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
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { TenantApplicationsService } from '../services/tenant-applications.service';
import { ApplicationLifecycleService } from '../services/application-lifecycle.service';
import { ApplicationConversionService } from '../services/application-conversion.service';
import { ListApplicationsQueryDto } from '../dto/list-applications.query.dto';
import { RejectApplicationDto } from '../dto/reject-application.dto';
import { ApplicationResponseDto } from '../dto/application-response.dto';
import { ConversionResponseDto } from '../dto/conversion-response.dto';

// Owner/Manager/Staff-facing application management. Never nests under
// `/organizations/:id` (spec: follow the complaints/food pattern instead -
// all org/property/role scoping happens inside the service layer via
// MembershipsService, guarded only by JwtAuthGuard here).
@ApiTags('tenant-discovery: applications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class ApplicationsController {
  constructor(
    private readonly applications: TenantApplicationsService,
    private readonly lifecycle: ApplicationLifecycleService,
    private readonly conversion: ApplicationConversionService,
  ) {}

  @Get('properties/:propertyId/applications')
  @ApiOperation({
    summary: 'List applications for one property. STAFF may read.',
  })
  async listForProperty(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Query() query: ListApplicationsQueryDto,
  ) {
    return this.applications.findManyForOrg(user, propertyId, query);
  }

  @Get('applications/:id')
  @ApiOperation({
    summary: 'Get one application. 404 outside the caller’s organization.',
  })
  @ApiResponse({ status: 200, type: ApplicationResponseDto })
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ApplicationResponseDto> {
    return this.applications.findOneForOrg(user, id);
  }

  @Post('applications/:id/review')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SUBMITTED -> UNDER_REVIEW. OWNER/MANAGER only.' })
  @ApiResponse({ status: 200, type: ApplicationResponseDto })
  async review(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ApplicationResponseDto> {
    return this.lifecycle.review(user, id);
  }

  @Post('applications/:id/approve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'UNDER_REVIEW/VISIT_SCHEDULED -> APPROVED. Never creates a Residency/BedAllocation/Invoice/Payment.',
  })
  @ApiResponse({ status: 200, type: ApplicationResponseDto })
  async approve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ApplicationResponseDto> {
    return this.lifecycle.approve(user, id);
  }

  @Post('applications/:id/reject')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'UNDER_REVIEW/VISIT_SCHEDULED -> REJECTED, with a public-safe reason.',
  })
  @ApiResponse({ status: 200, type: ApplicationResponseDto })
  async reject(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RejectApplicationDto,
  ): Promise<ApplicationResponseDto> {
    return this.lifecycle.reject(user, id, dto);
  }

  @Post('applications/:id/start-onboarding')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Explicit, separate onboarding step for an APPROVED application - returns a tenantId; the owner then calls the existing POST /residencies manually.',
  })
  @ApiResponse({ status: 200, type: ConversionResponseDto })
  async startOnboarding(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ConversionResponseDto> {
    return this.conversion.startOnboarding(user, id);
  }
}
