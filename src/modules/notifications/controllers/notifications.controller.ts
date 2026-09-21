import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { NotificationsService } from '../services/notifications.service';
import { ListNotificationsQueryDto } from '../dto/list-notifications.query.dto';
import { NotificationResponseDto } from '../dto/notification-response.dto';
import { PaginatedResult } from '../../../common/dto/pagination-query.dto';

// Every route resolves the caller's own notifications only - never a
// client-supplied userId/tenantId/organizationId (spec section 24/65).
// Works identically for OWNER/MANAGER/STAFF/TENANT (spec section 25):
// notifications belong to the authenticated user, not to a role.
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the caller’s own notifications, newest first.',
  })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<PaginatedResult<NotificationResponseDto>> {
    return this.notifications.findForUser(user, query);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Database-aggregated unread notification count.' })
  async unreadCount(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ count: number }> {
    const count = await this.notifications.getUnreadCount(user);
    return { count };
  }

  @Get(':id')
  @ApiOperation({
    summary:
      '404 both when it does not exist and when it belongs to another user.',
  })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<NotificationResponseDto> {
    return this.notifications.findOne(user, id);
  }

  @Post(':id/read')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Mark one notification READ. Idempotent - already-READ returns success.',
  })
  async markRead(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<NotificationResponseDto> {
    return this.notifications.markRead(user, id);
  }

  @Post('read-all')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Mark every one of the caller’s own UNREAD notifications READ.',
  })
  async markAllRead(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<{ updated: number }> {
    return this.notifications.markAllRead(user);
  }
}
