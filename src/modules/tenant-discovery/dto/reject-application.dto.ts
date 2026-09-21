import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// `reason` is public-safe by construction - it becomes
// TenantApplication.rejectionReason, the only owner-authored text ever
// shown to the applicant. Internal deliberations belong in a future
// internal-notes endpoint, never in this field.
export class RejectApplicationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  reason?: string;
}
