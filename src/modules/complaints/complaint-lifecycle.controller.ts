import {
  Body,
  Controller,
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
import { ComplaintLifecycleService } from './complaint-lifecycle.service';
import { AssignComplaintDto } from './dto/assign-complaint.dto';
import { ResolveComplaintDto } from './dto/resolve-complaint.dto';
import { ChangePriorityDto } from './dto/change-priority.dto';
import { ComplaintResponseDto } from './dto/complaint-response.dto';

// Every lifecycle transition is its own explicit action (spec: "do NOT
// use unrestricted PATCH for lifecycle state") - never a generic
// PATCH {status}.
@ApiTags('complaints')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('complaints')
export class ComplaintLifecycleController {
  constructor(private readonly lifecycle: ComplaintLifecycleService) {}

  @Post(':id/assign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Assign (or re-assign) a complaint to an OWNER/MANAGER/STAFF member of the same organization; also transitions OPEN -> ASSIGNED. OWNER/MANAGER only.',
  })
  @ApiResponse({ status: 200, type: ComplaintResponseDto })
  async assign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: AssignComplaintDto,
  ): Promise<ComplaintResponseDto> {
    return this.lifecycle.assign(user, id, dto);
  }

  @Post(':id/unassign')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Clear the assignee and return an ASSIGNED complaint to OPEN. OWNER/MANAGER only.',
  })
  @ApiResponse({ status: 200, type: ComplaintResponseDto })
  async unassign(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ComplaintResponseDto> {
    return this.lifecycle.unassign(user, id);
  }

  @Post(':id/priority')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Change priority (including to URGENT, which a tenant can never set directly). OWNER/MANAGER only.',
  })
  @ApiResponse({ status: 200, type: ComplaintResponseDto })
  async changePriority(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ChangePriorityDto,
  ): Promise<ComplaintResponseDto> {
    return this.lifecycle.changePriority(user, id, dto);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'ASSIGNED -> IN_PROGRESS. OWNER/MANAGER may start any complaint in their organization; STAFF only a complaint assigned to themselves.',
  })
  @ApiResponse({ status: 200, type: ComplaintResponseDto })
  async start(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ComplaintResponseDto> {
    return this.lifecycle.start(user, id);
  }

  @Post(':id/resolve')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'IN_PROGRESS -> RESOLVED, with a required resolution note. Same OWNER/MANAGER/assigned-STAFF rule as start.',
  })
  @ApiResponse({ status: 200, type: ComplaintResponseDto })
  async resolve(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: ResolveComplaintDto,
  ): Promise<ComplaintResponseDto> {
    return this.lifecycle.resolve(user, id, dto);
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'RESOLVED -> CLOSED. OWNER/MANAGER only.' })
  @ApiResponse({ status: 200, type: ComplaintResponseDto })
  async close(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ComplaintResponseDto> {
    return this.lifecycle.close(user, id);
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'OPEN -> CANCELLED. By the reporting tenant themselves, or by OWNER/MANAGER.',
  })
  @ApiResponse({ status: 200, type: ComplaintResponseDto })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ComplaintResponseDto> {
    return this.lifecycle.cancel(user, id);
  }
}
