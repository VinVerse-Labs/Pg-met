import { ApiProperty } from '@nestjs/swagger';

// What a Razorpay Checkout client needs to open the payment sheet - same
// shape as Phase 6's PaymentOrderResponseDto, kept as its own class so
// this module never imports from PaymentsModule (see
// PaymentGatewayModule's doc comment for the dependency direction this
// preserves).
export class SubscriptionPaymentOrderResponseDto {
  @ApiProperty()
  subscriptionPaymentId!: string;

  @ApiProperty()
  providerOrderId!: string;

  @ApiProperty({
    description: 'Amount in the smallest currency unit (paise for INR).',
  })
  amountInSmallestUnit!: number;

  @ApiProperty({ example: '499.00' })
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  keyId!: string;
}
