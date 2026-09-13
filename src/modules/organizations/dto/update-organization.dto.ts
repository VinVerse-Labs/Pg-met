import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

// Deliberately name-only. Organization.status (ACTIVE/INACTIVE/SUSPENDED)
// is not settable through this endpoint - suspension in particular is a
// platform-level moderation action, and letting an OWNER un-suspend their
// own organization through this DTO would defeat the point of having the
// status at all. A SUPER_ADMIN-only status-management endpoint is a
// Phase 3+ concern (see README "What Phase 3 needs").
export class UpdateOrganizationDto {
  @ApiProperty({ minLength: 2, maxLength: 150 })
  @IsString()
  @MinLength(2)
  @MaxLength(150)
  name!: string;
}
