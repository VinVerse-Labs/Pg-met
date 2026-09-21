import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../platform-admin/guards/platform-admin.guard';
import { PrismaService } from '../../../database/prisma.service';

// Deliberately the only Super Admin surface this phase adds (spec section
// 63-64: "Super Admin should not automatically see every user's
// notification... notifications are user-private... do not violate user
// privacy"). Read-only aggregate delivery-health counts only - never a
// notification's own title/body/data, and no `GET /admin/notifications`
// listing individual rows exists at all.
@ApiTags('platform-admin: notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/notifications')
export class NotificationAdminController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Platform-wide delivery-health counts only - never notification contents. SUPER_ADMIN only.',
  })
  async overview() {
    const [total, unread, deliveriesByStatus, deliveriesByChannel] =
      await Promise.all([
        this.prisma.notification.count(),
        this.prisma.notification.count({ where: { status: 'UNREAD' } }),
        this.prisma.notificationDelivery.groupBy({
          by: ['status'],
          _count: { _all: true },
        }),
        this.prisma.notificationDelivery.groupBy({
          by: ['channel'],
          _count: { _all: true },
        }),
      ]);
    return {
      totalNotifications: total,
      unreadNotifications: unread,
      deliveriesByStatus: Object.fromEntries(
        deliveriesByStatus.map((row) => [row.status, row._count._all]),
      ),
      deliveriesByChannel: Object.fromEntries(
        deliveriesByChannel.map((row) => [row.channel, row._count._all]),
      ),
    };
  }
}
