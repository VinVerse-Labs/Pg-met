import { ApiProperty } from '@nestjs/swagger';
import { OrganizationStatus, SubscriptionStatus } from '@prisma/client';

// The list-view shape (spec: "support pagination, search, status
// filtering, subscription-status filtering, creation-date filtering" -
// deliberately lean, no owner/property arrays; see
// AdminOrganizationDetailResponseDto for the full drill-down view).
export class AdminOrganizationListItemDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: OrganizationStatus })
  status!: OrganizationStatus;

  @ApiProperty({ nullable: true, enum: SubscriptionStatus })
  subscriptionStatus!: SubscriptionStatus | null;

  @ApiProperty()
  propertyCount!: number;

  @ApiProperty()
  createdAt!: Date;
}

class AdminOwnerSummaryDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;
}

class AdminSubscriptionSummaryDto {
  @ApiProperty()
  planName!: string;

  @ApiProperty({ enum: SubscriptionStatus })
  status!: SubscriptionStatus;

  @ApiProperty()
  currentPeriodEnd!: Date;

  @ApiProperty()
  nextBillingAt!: Date;

  @ApiProperty({ nullable: true, type: Date })
  gracePeriodEndsAt!: Date | null;
}

// Never exposes: password hashes, refresh tokens, raw KYC data, or any
// payment-provider secret - only what an operator needs to understand
// and act on this organization's account (spec: "avoid exposing
// unnecessary sensitive user information").
export class AdminOrganizationDetailResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: OrganizationStatus })
  status!: OrganizationStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ nullable: true, type: AdminOwnerSummaryDto })
  owner!: AdminOwnerSummaryDto | null;

  @ApiProperty({ nullable: true, type: AdminSubscriptionSummaryDto })
  subscription!: AdminSubscriptionSummaryDto | null;

  @ApiProperty()
  propertyCount!: number;

  @ApiProperty()
  roomCount!: number;

  @ApiProperty()
  bedCount!: number;

  @ApiProperty()
  occupiedBedCount!: number;

  @ApiProperty()
  tenantCount!: number;

  @ApiProperty({
    example: 62.5,
    description: 'occupiedBedCount / bedCount * 100, 0 when there are no beds.',
  })
  occupancyPercentage!: number;
}
