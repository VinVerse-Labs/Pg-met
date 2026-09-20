import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';

// No amount field at all - the server always reads
// SubscriptionInvoice.total (spec: "never accept the subscription price
// from the mobile/web client"). `idempotencyKey` is body-supplied here
// (unlike Phase 6's header-based one) to match this phase's spec section
// 28 request example literally.
export class CreateSubscriptionPaymentOrderDto {
  @ApiPropertyOptional({ example: 'client-generated-key' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  idempotencyKey?: string;
}
