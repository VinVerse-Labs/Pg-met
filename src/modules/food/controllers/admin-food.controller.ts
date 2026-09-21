import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../platform-admin/guards/platform-admin.guard';
import { PrismaService } from '../../../database/prisma.service';

// Global, read-only platform visibility (spec section 51: "do not create
// unnecessary platform write operations" / "Super Admin is primarily
// global visibility/oversight"). Deliberately just aggregate counts -
// the same "do not duplicate business logic, and do not give Super Admin
// arbitrary database mutation" principle Phase 9's AdminComplaintsController
// already established, scaled down here to counts rather than full lists
// since food's own org-scoped list endpoints already exist for a
// SUPER_ADMIN caller to inspect one organization/property at a time via
// its own membership bypass.
@ApiTags('platform-admin: food')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/food')
export class AdminFoodController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('overview')
  @ApiOperation({
    summary:
      'Platform-wide food counts: plans, active subscriptions, invoices by status. SUPER_ADMIN only.',
  })
  async overview() {
    const [
      totalPlans,
      activePlans,
      activeSubscriptions,
      pausedSubscriptions,
      issuedInvoices,
      paidInvoices,
      totalMenus,
      publishedMenus,
    ] = await Promise.all([
      this.prisma.foodPlan.count(),
      this.prisma.foodPlan.count({ where: { status: 'ACTIVE' } }),
      this.prisma.tenantFoodSubscription.count({ where: { status: 'ACTIVE' } }),
      this.prisma.tenantFoodSubscription.count({ where: { status: 'PAUSED' } }),
      this.prisma.foodSubscriptionInvoice.count({
        where: { status: { in: ['ISSUED', 'OVERDUE'] } },
      }),
      this.prisma.foodSubscriptionInvoice.count({ where: { status: 'PAID' } }),
      this.prisma.menu.count(),
      this.prisma.menu.count({ where: { status: 'PUBLISHED' } }),
    ]);
    return {
      totalPlans,
      activePlans,
      activeSubscriptions,
      pausedSubscriptions,
      issuedInvoices,
      paidInvoices,
      totalMenus,
      publishedMenus,
    };
  }
}
