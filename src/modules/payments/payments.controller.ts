import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PaymentsService } from './payments.service';
import { VerifyPaymentDto } from './dto/verify-payment.dto';
import { RefundPaymentDto } from './dto/refund-payment.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('payments')
@UseGuards(JwtAuthGuard)
export class PaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Get(':id')
  @ApiOperation({
    summary:
      'Get one payment, including its owner-settlement summary if one exists. Visible to the payment’s own payer, and to OWNER/MANAGER/STAFF of the owning organization.',
  })
  @ApiResponse({ status: 200, type: PaymentResponseDto })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.findOne(user, id);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Independently verify a Razorpay Checkout callback and finalize the payment if genuine. Only the payment’s own payer may call this.',
  })
  @ApiResponse({ status: 200, type: PaymentResponseDto })
  @ApiResponse({ status: 400, description: 'Signature verification failed.' })
  async verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: VerifyPaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.verifyPayment(user, id, dto);
  }

  @Post(':id/refund')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Refund a captured payment (fully or partially). OWNER/MANAGER of the owning organization only - never the tenant themselves.',
  })
  @ApiResponse({ status: 200, type: PaymentResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Payment is not in a refundable state.',
  })
  async refund(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: RefundPaymentDto,
  ): Promise<PaymentResponseDto> {
    return this.paymentsService.refund(user, id, dto);
  }
}
