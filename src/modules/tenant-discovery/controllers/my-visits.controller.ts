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
import { CancelVisitDto, RequestVisitDto } from '../dto/schedule-visit.dto';
import { VisitResponseDto } from '../dto/visit-response.dto';

@ApiTags('tenant-discovery: my visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/visits')
export class MyVisitsController {
  constructor(private readonly visits: PropertyVisitsService) {}

  @Get()
  @ApiOperation({ summary: 'List the caller’s own visits.' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ) {
    return this.visits.findManyForApplicant(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of the caller’s own visits.' })
  @ApiResponse({ status: 200, type: VisitResponseDto })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<VisitResponseDto> {
    return this.visits.findOneForApplicant(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel the caller’s own visit.' })
  @ApiResponse({ status: 200, type: VisitResponseDto })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CancelVisitDto,
  ): Promise<VisitResponseDto> {
    return this.visits.cancel(user, id, dto);
  }
}

// Nested under MyApplicationsController's resource conceptually, but its
// own controller class (spec's exact path:
// `POST /me/applications/:applicationId/visits`) - kept in this file since
// it is still visit-domain logic, using PropertyVisitsService.request.
@ApiTags('tenant-discovery: my visits')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/applications/:applicationId/visits')
export class MyApplicationVisitsController {
  constructor(private readonly visits: PropertyVisitsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Request a visit for one of the caller’s own applications (REQUESTED, no time yet).',
  })
  @ApiResponse({ status: 201, type: VisitResponseDto })
  async request(
    @CurrentUser() user: AuthenticatedUser,
    @Param('applicationId') applicationId: string,
    @Body() dto: RequestVisitDto,
  ): Promise<VisitResponseDto> {
    return this.visits.request(user, applicationId, dto);
  }
}
