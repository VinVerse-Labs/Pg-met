import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

// `amount` is optional - omitting it means "refund whatever remains
// un-refunded on this payment" (spec section 37). When supplied, it must
// still be a decimal string, never a JS number (spec section 39).
export class RefundPaymentDto {
  @ApiPropertyOptional({ example: '4000.00' })
  @IsOptional()
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message:
      'amount must be a positive decimal string with up to 2 decimal places',
  })
  amount?: string;

  @ApiPropertyOptional({ example: 'Duplicate payment' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
