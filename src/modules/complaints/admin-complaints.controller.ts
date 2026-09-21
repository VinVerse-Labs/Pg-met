import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlatformAdminGuard } from '../platform-admin/guards/platform-admin.guard';
import { ComplaintsService } from './complaints.service';
import { ListComplaintsQueryDto } from './dto/list-complaints.query.dto';
import { ComplaintResponseDto } from './dto/complaint-response.dto';

// Global, read-only platform visibility (spec: "Super Admin is primarily
// global visibility/oversight... do not duplicate complaint business
// logic" and "do not give Super Admin arbitrary database mutation") -
// this controller reuses ComplaintsService.findMany/findOne exactly as
// they already behave for a SUPER_ADMIN caller (unscoped), rather than
// building a parallel query path. No write endpoint exists here.
@ApiTags('platform-admin: complaints')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/complaints')
export class AdminComplaintsController {
  constructor(private readonly complaintsService: ComplaintsService) {}

  @Get()
  @ApiOperation({
    summary: 'List every complaint on the platform. SUPER_ADMIN only.',
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListComplaintsQueryDto,
  ) {
    return this.complaintsService.findMany(user, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one complaint, platform-wide. SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 200, type: ComplaintResponseDto })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ComplaintResponseDto> {
    return this.complaintsService.findOne(user, id);
  }
}
