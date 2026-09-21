import { ApiProperty } from '@nestjs/swagger';

export class FoodPaymentOrderResponseDto {
  @ApiProperty()
  foodSubscriptionPaymentId!: string;

  @ApiProperty()
  providerOrderId!: string;

  @ApiProperty({
    description: 'Amount in the smallest currency unit (paise for INR).',
  })
  amountInSmallestUnit!: number;

  @ApiProperty({ example: '2500.00' })
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty()
  keyId!: string;
}
