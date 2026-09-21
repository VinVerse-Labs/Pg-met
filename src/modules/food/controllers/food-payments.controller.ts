import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { FoodBillingService } from '../services/food-billing.service';
import { CreateFoodPaymentOrderDto } from '../dto/create-food-payment-order.dto';
import { VerifyFoodPaymentDto } from '../dto/verify-food-payment.dto';
import { FoodPaymentOrderResponseDto } from '../dto/food-payment-order-response.dto';
import { FoodPaymentResponseDto } from '../dto/food-payment-response.dto';
import { FoodSubscriptionInvoiceResponseDto } from '../dto/food-subscription-invoice-response.dto';

@ApiTags('food')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class FoodPaymentsController {
  constructor(private readonly billing: FoodBillingService) {}

  @Get('food/invoices/:id')
  @ApiOperation({ summary: 'Get one food subscription invoice by id.' })
  async findInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<FoodSubscriptionInvoiceResponseDto> {
    const invoice = await this.billing.getAccessibleInvoiceOrThrow(user, id);
    return FoodSubscriptionInvoiceResponseDto.fromEntity(invoice);
  }

  @Post('food/invoices/:invoiceId/payments')
  @ApiOperation({
    summary:
      'Create a Razorpay order for this invoice. Amount is always the invoice total, never client-supplied.',
  })
  async createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: CreateFoodPaymentOrderDto,
  ): Promise<FoodPaymentOrderResponseDto> {
    return this.billing.createOrder(user, invoiceId, dto);
  }

  @Get('food/payments/:id')
  @ApiOperation({ summary: 'Get one food payment by id.' })
  async findPayment(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<FoodPaymentResponseDto> {
    const payment = await this.billing.getAccessiblePaymentOrThrow(user, id);
    return FoodPaymentResponseDto.fromEntity(payment);
  }

  @Post('food/payments/:id/verify')
  @ApiOperation({
    summary:
      'Verify a Razorpay Checkout callback and finalize the payment if captured.',
  })
  async verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: VerifyFoodPaymentDto,
  ): Promise<FoodPaymentResponseDto> {
    return this.billing.verifyPayment(user, id, dto);
  }
}
