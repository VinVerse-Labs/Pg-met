import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

// The three fields Razorpay Checkout returns to the client on success -
// used to independently verify the payment server-side (spec section 28)
// rather than trusting the client's "it worked" claim.
export class VerifyPaymentDto {
  @ApiProperty()
  @IsString()
  @MinLength(1)
  razorpayOrderId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  razorpayPaymentId!: string;

  @ApiProperty()
  @IsString()
  @MinLength(1)
  razorpaySignature!: string;
}
