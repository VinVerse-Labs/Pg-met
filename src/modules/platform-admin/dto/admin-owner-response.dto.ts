import { ApiProperty } from '@nestjs/swagger';
import { UserStatus } from '@prisma/client';

class AdminOwnerOrganizationSummaryDto {
  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  organizationName!: string;

  @ApiProperty()
  propertyCount!: number;

  @ApiProperty({ nullable: true, type: String })
  subscriptionStatus!: string | null;
}

// One owner may manage multiple organizations (spec: "do not assume 1
// Owner = 1 Property" - and, more precisely, an owner is not assumed to
// have exactly one organization either). Never exposes passwordHash or
// refresh tokens.
export class AdminOwnerResponseDto {
  @ApiProperty()
  userId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  email!: string | null;

  @ApiProperty({ enum: UserStatus })
  status!: UserStatus;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty({ type: [AdminOwnerOrganizationSummaryDto] })
  organizations!: AdminOwnerOrganizationSummaryDto[];
}
