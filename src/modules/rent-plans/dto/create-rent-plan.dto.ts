import { ApiProperty } from '@nestjs/swagger';
import {
  IsDateString,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  Min,
} from 'class-validator';

// `amount` is a validated STRING, not a number - a JS `number` in the
// request body would already have been round-tripped through IEEE-754
// float parsing by the time it reaches this DTO, which is exactly the
// precision loss spec section 5 says to avoid. The regex only allows up to
// 2 decimal places; RentPlansService constructs a `Prisma.Decimal`
// directly from this string (never via `parseFloat`), so no float ever
// exists in the pipeline.
const DECIMAL_PATTERN = /^\d{1,10}(\.\d{1,2})?$/;

export class CreateRentPlanDto {
  @ApiProperty({
    example: '8000.00',
    description:
      'Monthly rent amount as a decimal string, up to 2 decimal places.',
  })
  @IsString()
  @Matches(DECIMAL_PATTERN, {
    message: 'amount must be a decimal string with at most 2 decimal places',
  })
  amount!: string;

  @ApiProperty({
    minimum: 1,
    maximum: 31,
    description:
      "Day of the month rent is due. A month without that day (e.g. 31 in February) falls back to that month's last day.",
  })
  @IsInt()
  @Min(1)
  @Max(31)
  dueDay!: number;

  @ApiProperty({ description: 'When this rent rate takes effect (ISO 8601).' })
  @IsDateString()
  effectiveFrom!: string;

  @ApiProperty({ required: false, default: 'INR' })
  @IsOptional()
  @IsString()
  currency?: string;
}
