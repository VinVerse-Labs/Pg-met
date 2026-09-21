import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// No amount field - the server always reads
// FoodSubscriptionInvoice.total, never a client-supplied amount.
export class CreateFoodPaymentOrderDto {
  @ApiPropertyOptional({ example: 'client-generated-key' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}
