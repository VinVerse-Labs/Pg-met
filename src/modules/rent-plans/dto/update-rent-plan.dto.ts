import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsOptional, Max, Min } from 'class-validator';

// Deliberately NOT `amount`/`effectiveFrom`/`currency` - those are
// immutable once a RentPlan is created (spec section 8: changing rent
// creates a new plan via POST, it never mutates the old one). `dueDay` is
// a safe correction (doesn't affect any already-generated invoice's
// stored `dueDate`). `deactivate` is the one controlled status
// transition (ACTIVE -> INACTIVE) - a boolean action flag, not a raw
// `status` field a client could set to any enum value (spec section 7).
export class UpdateRentPlanDto {
  @ApiProperty({ required: false, minimum: 1, maximum: 31 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay?: number;

  @ApiProperty({
    required: false,
    description:
      'Set to true to deactivate this plan (must currently be ACTIVE).',
  })
  @IsOptional()
  @IsBoolean()
  deactivate?: boolean;
}
