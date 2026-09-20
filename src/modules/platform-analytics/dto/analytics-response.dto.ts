import { ApiProperty } from '@nestjs/swagger';

export class PlatformOverviewDto {
  @ApiProperty() totalOrganizations!: number;
  @ApiProperty() activeOrganizations!: number;
  @ApiProperty() inactiveOrganizations!: number;
  @ApiProperty() suspendedOrganizations!: number;
  @ApiProperty() trialOrganizations!: number;
  @ApiProperty() activeSubscriptionOrganizations!: number;

  @ApiProperty() totalProperties!: number;
  @ApiProperty() activeProperties!: number;
  @ApiProperty() archivedProperties!: number;

  @ApiProperty() totalRooms!: number;
  @ApiProperty() totalBeds!: number;
  @ApiProperty() occupiedBeds!: number;
  @ApiProperty() availableBeds!: number;
  @ApiProperty() inactiveBeds!: number;
  @ApiProperty({ example: 62.5 }) occupancyPercentage!: number;

  @ApiProperty() totalTenants!: number;
  @ApiProperty() activeResidents!: number;
  @ApiProperty() checkedOutResidents!: number;

  @ApiProperty() activeSubscriptions!: number;
  @ApiProperty() trialSubscriptions!: number;
  @ApiProperty() renewalDueSubscriptions!: number;
  @ApiProperty() gracePeriodSubscriptions!: number;
  @ApiProperty() suspendedSubscriptions!: number;
  @ApiProperty() cancelledSubscriptions!: number;
}

export class MonthlyRevenuePointDto {
  @ApiProperty({ example: '2026-01' }) month!: string;
  @ApiProperty({ example: '50000.00' }) revenue!: string;
}

// Deliberately all `SaaS...` fields here - never labeled "Platform
// Revenue" if it isn't SaaS money (spec: "do not mix tenant rent revenue
// with platform SaaS revenue"). See TenantPaymentMetricsDto for the
// separate, clearly-labeled tenant-rent figures.
export class RevenueMetricsDto {
  @ApiProperty({ example: '125000.00' }) saasRevenueCollected!: string;
  @ApiProperty({ example: '18000.00' }) currentMonthRevenue!: string;
  @ApiProperty({ example: '16500.00' }) previousMonthRevenue!: string;
  @ApiProperty({ example: '4990.00' }) outstandingSaasInvoices!: string;
  @ApiProperty() failedSubscriptionPayments!: number;
  @ApiProperty() activePayingOrganizations!: number;
  @ApiProperty({ type: [MonthlyRevenuePointDto] })
  monthlyRevenue!: MonthlyRevenuePointDto[];
}

// Explicitly labeled "Tenant Rent Volume", never "Revenue" (spec: "if
// tenant rent metrics are displayed, label them clearly as Tenant Rent
// Volume, not Platform Revenue") - this money belongs primarily to PG
// owners; only `platformFeesCollected` is actually the platform's own
// money, and even that is reported separately from SaaS revenue.
export class TenantPaymentMetricsDto {
  @ApiProperty({
    example: '2500000.00',
    description: 'Tenant Rent Volume - NOT platform revenue.',
  })
  totalTenantRentVolume!: string;

  @ApiProperty({ example: '210000.00' })
  currentMonthTenantRentVolume!: string;

  @ApiProperty({ example: '2500.00' })
  platformFeesCollected!: string;

  @ApiProperty({ example: '2497500.00' })
  ownerSettlementAmount!: string;
}

export class OccupancyMetricsDto {
  @ApiProperty() totalRooms!: number;
  @ApiProperty() totalBeds!: number;
  @ApiProperty() occupiedBeds!: number;
  @ApiProperty() availableBeds!: number;
  @ApiProperty() inactiveBeds!: number;
  @ApiProperty({ example: 62.5 }) occupancyPercentage!: number;
}

export class PlatformDashboardDto {
  @ApiProperty({ type: PlatformOverviewDto }) overview!: PlatformOverviewDto;
  @ApiProperty({ type: RevenueMetricsDto }) revenue!: RevenueMetricsDto;
  @ApiProperty({ type: OccupancyMetricsDto }) occupancy!: OccupancyMetricsDto;
  @ApiProperty({ type: TenantPaymentMetricsDto })
  tenantPayments!: TenantPaymentMetricsDto;
}
