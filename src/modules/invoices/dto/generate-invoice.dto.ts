import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

// Deliberately `year`+`month`, not `billingPeriodStart`/`billingPeriodEnd`
// dates - the client names *which calendar month* to bill, and the server
// alone computes the exact period/due-date boundaries (spec section 14's
// "use correct calendar calculations", never trusted from the client).
// There is no way for a client to supply a malformed or inconsistent
// period this way.
export class GenerateInvoiceDto {
  @ApiProperty({ example: 2027, minimum: 2000, maximum: 2100 })
  @IsInt()
  @Min(2000)
  @Max(2100)
  year!: number;

  @ApiProperty({ example: 1, minimum: 1, maximum: 12 })
  @IsInt()
  @Min(1)
  @Max(12)
  month!: number;
}
