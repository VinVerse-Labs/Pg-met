import {
  Body,
  Controller,
  Get,
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
import { ComplaintsService } from './complaints.service';
import { ComplaintActivityService } from './complaint-activity.service';
import { CreateComplaintDto } from './dto/create-complaint.dto';
import { ListComplaintsQueryDto } from './dto/list-complaints.query.dto';
import { ComplaintResponseDto } from './dto/complaint-response.dto';
import { ComplaintActivityResponseDto } from './dto/complaint-activity-response.dto';

@ApiTags('complaints')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('complaints')
export class ComplaintsController {
  constructor(
    private readonly complaintsService: ComplaintsService,
    private readonly activityService: ComplaintActivityService,
  ) {}

  @Post()
  @ApiOperation({
    summary:
      'Report a complaint against the caller’s own current residency. organizationId/tenantId/residencyId are always derived server-side, never accepted from the client.',
  })
  @ApiResponse({ status: 201, type: ComplaintResponseDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateComplaintDto,
  ): Promise<ComplaintResponseDto> {
    return this.complaintsService.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'List complaints, scoped to the caller: a tenant sees only their own; OWNER/MANAGER/STAFF see their organization’s; SUPER_ADMIN sees the platform.',
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListComplaintsQueryDto,
  ) {
    return this.complaintsService.findMany(user, query);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      '404 both when it does not exist and when the caller has no legitimate relationship to it (not the reporting tenant, not an organization member, not SUPER_ADMIN).',
  })
  @ApiResponse({ status: 200, type: ComplaintResponseDto })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ComplaintResponseDto> {
    return this.complaintsService.findOne(user, id);
  }

  @Get(':id/activity')
  @ApiOperation({
    summary:
      'Immutable activity trail. Visible to the same audience as the complaint itself - never contains a comment’s body text, so PUBLIC/INTERNAL visibility never applies here.',
  })
  @ApiResponse({ status: 200, type: [ComplaintActivityResponseDto] })
  async findActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ComplaintActivityResponseDto[]> {
    await this.complaintsService.getAccessibleComplaintOrThrow(user, id);
    return this.activityService.findForComplaint(id);
  }
}
