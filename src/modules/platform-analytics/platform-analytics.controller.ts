import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../platform-admin/guards/platform-admin.guard';
import { PlatformAnalyticsService } from './platform-analytics.service';
import { RevenueQueryDto } from './dto/revenue-query.dto';
import {
  OccupancyMetricsDto,
  PlatformDashboardDto,
  PlatformOverviewDto,
  RevenueMetricsDto,
  TenantPaymentMetricsDto,
} from './dto/analytics-response.dto';

@ApiTags('platform-admin: analytics')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin')
export class PlatformAnalyticsController {
  constructor(private readonly analyticsService: PlatformAnalyticsService) {}

  @Get('dashboard')
  @ApiOperation({
    summary:
      'Full platform dashboard: overview + revenue + occupancy + tenant-payment metrics in one response. SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 200, type: PlatformDashboardDto })
  async getDashboard(
    @Query() query: RevenueQueryDto,
  ): Promise<PlatformDashboardDto> {
    return this.analyticsService.getDashboard(query);
  }

  @Get('analytics/overview')
  @ApiOperation({
    summary:
      'Organization/property/capacity/tenant/subscription counts. SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 200, type: PlatformOverviewDto })
  async getOverview(): Promise<PlatformOverviewDto> {
    return this.analyticsService.getOverview();
  }

  @Get('analytics/revenue')
  @ApiOperation({
    summary:
      'SaaS revenue only - never tenant rent (see README’s "Phase 8" section). Supports ?from&to date-range filtering. SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 200, type: RevenueMetricsDto })
  async getRevenue(
    @Query() query: RevenueQueryDto,
  ): Promise<RevenueMetricsDto> {
    return this.analyticsService.getRevenueMetrics(query);
  }

  @Get('analytics/occupancy')
  @ApiOperation({
    summary: 'Platform-wide room/bed occupancy. SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 200, type: OccupancyMetricsDto })
  async getOccupancy(): Promise<OccupancyMetricsDto> {
    return this.analyticsService.getOccupancyMetrics();
  }

  @Get('analytics/tenant-payments')
  @ApiOperation({
    summary:
      'Tenant Rent Volume, platform fees, and owner settlements - explicitly labeled, never called "revenue" (see README). SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 200, type: TenantPaymentMetricsDto })
  async getTenantPayments(
    @Query() query: RevenueQueryDto,
  ): Promise<TenantPaymentMetricsDto> {
    return this.analyticsService.getTenantPaymentMetrics(query);
  }
}
