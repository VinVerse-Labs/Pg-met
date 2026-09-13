import { ApiProperty } from '@nestjs/swagger';
import {
  MembershipRole,
  Organization,
  OrganizationStatus,
} from '@prisma/client';

// Built explicitly, never `return organization` - same reasoning as
// UserResponseDto (Phase 1): a future column added to the table should
// never automatically become public API surface.
export class OrganizationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ enum: OrganizationStatus })
  status!: OrganizationStatus;

  @ApiProperty({
    enum: MembershipRole,
    nullable: true,
    description:
      "The requesting user's role in this organization. Null only for a SUPER_ADMIN viewing an organization they are not a member of.",
  })
  yourRole!: MembershipRole | null;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(
    organization: Organization,
    yourRole: MembershipRole | null = null,
  ): OrganizationResponseDto {
    const dto = new OrganizationResponseDto();
    dto.id = organization.id;
    dto.name = organization.name;
    dto.status = organization.status;
    dto.yourRole = yourRole;
    dto.createdAt = organization.createdAt;
    return dto;
  }
}
