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
import { PaginationQueryDto } from '../../../common/dto/pagination-query.dto';
import { PropertyVisitsService } from '../services/property-visits.service';
import { CancelVisitDto, ScheduleVisitDto } from '../dto/schedule-visit.dto';
import { VisitResponseDto } from '../dto/visit-response.dto';

// Owner/Manager/Staff-facing visit management, plus the shared
// applicant/owner cancel action.
@ApiTags('tenant-discovery: visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class VisitsController {
  constructor(private readonly visits: PropertyVisitsService) {}

  @Get('properties/:propertyId/visits')
  @ApiOperation({ summary: 'List visits for one property. STAFF may read.' })
  async listForProperty(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Query() query: PaginationQueryDto,
  ) {
    return this.visits.findManyForOrg(user, propertyId, query);
  }

  @Get('visits/:id')
  @ApiOperation({
    summary: 'Get one visit. 404 outside the caller’s organization.',
  })
  @ApiResponse({ status: 200, type: VisitResponseDto })
  async getOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<VisitResponseDto> {
    return this.visits.findOneForOrg(user, id);
  }

  @Post('applications/:applicationId/visits')
  @ApiOperation({
    summary:
      'Owner/manager-initiated scheduling - creates a visit straight to SCHEDULED with a time. Conflict-checked.',
  })
  @ApiResponse({ status: 201, type: VisitResponseDto })
  async scheduleNew(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId') applicationId: string,
    @Body() dto: ScheduleVisitDto,
  ): Promise<VisitResponseDto> {
    return this.visits.scheduleNew(user, applicationId, dto);
  }

  @Post('visits/:id/confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'REQUESTED -> SCHEDULED, with a chosen time. Conflict-checked.',
  })
  @ApiResponse({ status: 200, type: VisitResponseDto })
  async confirm(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ScheduleVisitDto,
  ): Promise<VisitResponseDto> {
    return this.visits.confirm(user, id, dto);
  }

  @Post('visits/:id/reschedule')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'SCHEDULED -> SCHEDULED, same row, new time. Conflict-checked.',
  })
  @ApiResponse({ status: 200, type: VisitResponseDto })
  async reschedule(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ScheduleVisitDto,
  ): Promise<VisitResponseDto> {
    return this.visits.reschedule(user, id, dto);
  }

  @Post('visits/:id/complete')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SCHEDULED -> COMPLETED.' })
  @ApiResponse({ status: 200, type: VisitResponseDto })
  async complete(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<VisitResponseDto> {
    return this.visits.complete(user, id);
  }

  @Post('visits/:id/no-show')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'SCHEDULED -> NO_SHOW.' })
  @ApiResponse({ status: 200, type: VisitResponseDto })
  async noShow(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<VisitResponseDto> {
    return this.visits.noShow(user, id);
  }

  @Post('visits/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'REQUESTED/SCHEDULED -> CANCELLED. Either the applicant or an OWNER/MANAGER may cancel.',
  })
  @ApiResponse({ status: 200, type: VisitResponseDto })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelVisitDto,
  ): Promise<VisitResponseDto> {
    return this.visits.cancel(user, id, dto);
  }
}
