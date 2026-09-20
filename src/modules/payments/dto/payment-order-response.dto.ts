import { ApiProperty } from '@nestjs/swagger';

// What a Razorpay Checkout client needs to open the payment sheet -
// deliberately not the full PaymentResponseDto (that's available via
// GET /payments/:paymentId once created). `keyId` is the public key,
// never the secret - safe to expose to a client.
export class PaymentOrderResponseDto {
  @ApiProperty()
  paymentId!: string;

  @ApiProperty()
  providerOrderId!: string;

  @ApiProperty({
    description: 'Amount in the smallest currency unit (paise for INR).',
  })
  amountInSmallestUnit!: number;

  @ApiProperty({ example: '4000.00' })
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  keyId!: string;
}
