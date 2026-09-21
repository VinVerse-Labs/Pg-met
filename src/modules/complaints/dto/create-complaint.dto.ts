import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { ComplaintCategory, ComplaintPriority } from '@prisma/client';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

// Deliberately has no `organizationId`/`tenantId`/`residencyId`/
// `reportedByUserId` field - all four are derived from the authenticated
// caller's own current residency at `propertyId`, never trusted from the
// client (spec: "these must be derived from authenticated context").
// `roomId`/`bedId` are optional - when omitted, ComplaintsService derives
// them from the tenant's active BedAllocation under that residency; when
// supplied, they are still independently verified server-side, never
// trusted as given (spec: "do not trust client relationships").
export class CreateComplaintDto {
  @ApiProperty()
  @IsUUID()
  propertyId!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  roomId?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  bedId?: string;

  @ApiProperty({ enum: ComplaintCategory })
  @IsEnum(ComplaintCategory)
  category!: ComplaintCategory;

  // A tenant-suggested priority - never trusted blindly. See
  // ComplaintsService.create: a tenant-supplied URGENT is capped to HIGH;
  // only OWNER/MANAGER/STAFF can actually set URGENT, via the dedicated
  // priority-change action.
  @ApiPropertyOptional({ enum: ComplaintPriority, default: 'MEDIUM' })
  @IsOptional()
  @IsEnum(ComplaintPriority)
  priority?: ComplaintPriority;

  @ApiProperty({ example: 'Bathroom tap leaking' })
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title!: string;

  @ApiProperty({
    example: 'The bathroom tap has been leaking since morning.',
  })
  @IsString()
  @MinLength(3)
  @MaxLength(4000)
  description!: string;
}
