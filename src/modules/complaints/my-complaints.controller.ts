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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { MyComplaintsService } from './my-complaints.service';
import { ListMyComplaintsQueryDto } from './dto/list-my-complaints.query.dto';
import { CreateMyCommentDto } from './dto/create-my-comment.dto';
import {
  MyComplaintActivityResponseDto,
  MyComplaintCommentResponseDto,
  MyComplaintResponseDto,
} from './dto/my-complaint-response.dto';

// Tenant-scoped complaint surface (Tenant Web). Creation stays on
// POST /complaints, which is already tenant-only (it derives the residency
// from the caller).
@ApiTags('complaints')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/complaints')
export class MyComplaintsController {
  constructor(private readonly myComplaints: MyComplaintsService) {}

  @Get()
  @ApiOperation({
    summary:
      "The caller's own complaints as a tenant - never organization complaints, even when the caller is also an org member.",
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMyComplaintsQueryDto,
  ) {
    return this.myComplaints.list(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: "404 unless it is the caller's own complaint." })
  @ApiResponse({ status: 200, type: MyComplaintResponseDto })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MyComplaintResponseDto> {
    return this.myComplaints.findOne(user, id);
  }

  @Get(':id/comments')
  @ApiOperation({
    summary:
      'PUBLIC comments only, each labelled YOU or PROPERTY_TEAM (no staff identity).',
  })
  @ApiResponse({ status: 200, type: [MyComplaintCommentResponseDto] })
  async findComments(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MyComplaintCommentResponseDto[]> {
    return this.myComplaints.findComments(user, id);
  }

  @Post(':id/comments')
  @ApiOperation({ summary: 'Add a PUBLIC comment to your own complaint.' })
  @ApiResponse({ status: 201, type: MyComplaintCommentResponseDto })
  async addComment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CreateMyCommentDto,
  ): Promise<MyComplaintCommentResponseDto> {
    return this.myComplaints.addComment(user, id, dto.body);
  }

  @Get(':id/activity')
  @ApiOperation({
    summary:
      'Status history of your own complaint (actor YOU / PROPERTY_TEAM).',
  })
  @ApiResponse({ status: 200, type: [MyComplaintActivityResponseDto] })
  async findActivity(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MyComplaintActivityResponseDto[]> {
    return this.myComplaints.findActivity(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'OPEN -> CANCELLED, for your own complaint.' })
  @ApiResponse({ status: 200, type: MyComplaintResponseDto })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MyComplaintResponseDto> {
    return this.myComplaints.cancel(user, id);
  }
}
