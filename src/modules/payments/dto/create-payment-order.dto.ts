import { ApiProperty } from '@nestjs/swagger';
import { Matches } from 'class-validator';

// Same decimal-string convention as Phase 5's CreateRentPlanDto - up to 10
// integer digits, up to 2 decimal places, never a JS number (spec
// sections 29/39). The server independently validates this against the
// invoice's outstanding balance; the client's number is never trusted as
// the final charge amount.
export class CreatePaymentOrderDto {
  @ApiProperty({
    example: '4000.00',
    description:
      'Amount to pay now (may be a partial payment). Must be > 0 and <= the outstanding balance.',
  })
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message:
      'amount must be a positive decimal string with up to 2 decimal places',
  })
  amount!: string;
}
