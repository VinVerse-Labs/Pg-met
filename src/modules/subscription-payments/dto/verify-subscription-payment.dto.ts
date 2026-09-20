import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

// Same three Razorpay Checkout callback fields as Phase 6's
// VerifyPaymentDto - the server independently verifies the signature,
// never trusting the client's "it worked" claim.
export class VerifySubscriptionPaymentDto {
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
