import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ComplaintCommentsService } from './complaint-comments.service';
import { CreateCommentDto } from './dto/create-comment.dto';
import { ComplaintCommentResponseDto } from './dto/complaint-comment-response.dto';

@ApiTags('complaints')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('complaints/:id/comments')
export class ComplaintCommentsController {
  constructor(private readonly commentsService: ComplaintCommentsService) {}

  @Get()
  @ApiOperation({
    summary:
      'List comments. A tenant never sees INTERNAL comments, regardless of what the complaint itself shows them.',
  })
  @ApiResponse({ status: 200, type: [ComplaintCommentResponseDto] })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') complaintId: string,
  ): Promise<ComplaintCommentResponseDto[]> {
    return this.commentsService.findForComplaint(user, complaintId);
  }

  @Post()
  @ApiOperation({
    summary:
      'Add a comment. A tenant may only create PUBLIC comments; INTERNAL is OWNER/MANAGER/STAFF/SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 201, type: ComplaintCommentResponseDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') complaintId: string,
    @Body() dto: CreateCommentDto,
  ): Promise<ComplaintCommentResponseDto> {
    return this.commentsService.create(user, complaintId, dto);
  }
}
