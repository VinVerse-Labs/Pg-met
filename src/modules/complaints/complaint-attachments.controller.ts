import {
  Body,
  Controller,
  Delete,
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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { ComplaintAttachmentsService } from './complaint-attachments.service';
import { CreateAttachmentDto } from './dto/create-attachment.dto';
import { ComplaintAttachmentResponseDto } from './dto/complaint-attachment-response.dto';

@ApiTags('complaints')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('complaints/:id/attachments')
export class ComplaintAttachmentsController {
  constructor(
    private readonly attachmentsService: ComplaintAttachmentsService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List a complaint’s attachments.' })
  @ApiResponse({ status: 200, type: [ComplaintAttachmentResponseDto] })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') complaintId: string,
  ): Promise<ComplaintAttachmentResponseDto[]> {
    return this.attachmentsService.findForComplaint(user, complaintId);
  }

  @Post()
  @ApiOperation({
    summary:
      'Register an already-uploaded file’s reference (this is not a file-upload endpoint - the client uploads elsewhere first). Validates MIME type and size.',
  })
  @ApiResponse({ status: 201, type: ComplaintAttachmentResponseDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') complaintId: string,
    @Body() dto: CreateAttachmentDto,
  ): Promise<ComplaintAttachmentResponseDto> {
    return this.attachmentsService.create(user, complaintId, dto);
  }

  @Delete(':attachmentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({
    summary:
      'Delete an attachment. Only its own uploader, or OWNER/MANAGER of the organization.',
  })
  async remove(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') complaintId: string,
    @Param('attachmentId') attachmentId: string,
  ): Promise<void> {
    await this.attachmentsService.remove(user, complaintId, attachmentId);
  }
}
