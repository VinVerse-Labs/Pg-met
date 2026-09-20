import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PaymentsService } from './payments.service';
import { CreatePaymentOrderDto } from './dto/create-payment-order.dto';
import { PaymentOrderResponseDto } from './dto/payment-order-response.dto';
import { PaymentResponseDto } from './dto/payment-response.dto';

@ApiTags('payments')
@ApiBearerAuth()
@Controller('invoices/:invoiceId/payments')
@UseGuards(JwtAuthGuard)
export class InvoicePaymentsController {
  constructor(private readonly paymentsService: PaymentsService) {}

  @Post('order')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      "Create a Razorpay payment order for (all or part of) this invoice's outstanding balance. Only the invoice's own tenant may call this.",
  })
  @ApiHeader({
    name: 'Idempotency-Key',
    required: false,
    description:
      'Client-generated key; retrying the same key returns the original order instead of creating a duplicate one.',
  })
  @ApiResponse({ status: 201, type: PaymentOrderResponseDto })
  @ApiResponse({
    status: 409,
    description:
      'Invoice is not payable, or amount exceeds the outstanding balance.',
  })
  async createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: CreatePaymentOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ): Promise<PaymentOrderResponseDto> {
    return this.paymentsService.createOrder(
      user,
      invoiceId,
      dto,
      idempotencyKey,
    );
  }

  @Get()
  @ApiOperation({
    summary:
      "List payments made against this invoice. Visible to the invoice's own tenant and to OWNER/MANAGER/STAFF of the owning organization.",
  })
  @ApiResponse({ status: 200, type: [PaymentResponseDto] })
  async findForInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('invoiceId') invoiceId: string,
  ): Promise<PaymentResponseDto[]> {
    return this.paymentsService.findForInvoice(user, invoiceId);
  }
}
