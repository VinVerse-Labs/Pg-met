import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// `price` is set exactly once, here, and never mutable afterward - see
// SaasPlansService.adminUpdate's doc comment for why (historical
// SubscriptionInvoice pricing must stay intact).
export class CreateSaasPlanDto {
  @ApiProperty({ example: 'Pro' })
  @IsString()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: 'For growing PG businesses' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ example: '999.00' })
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message:
      'price must be a positive decimal string with up to 2 decimal places',
  })
  price!: string;

  @ApiPropertyOptional({ example: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;
}
