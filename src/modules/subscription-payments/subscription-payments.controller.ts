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
import { SubscriptionPaymentsService } from './subscription-payments.service';
import { CreateSubscriptionPaymentOrderDto } from './dto/create-subscription-payment-order.dto';
import { VerifySubscriptionPaymentDto } from './dto/verify-subscription-payment.dto';
import { SubscriptionPaymentOrderResponseDto } from './dto/subscription-payment-order-response.dto';
import { SubscriptionPaymentResponseDto } from './dto/subscription-payment-response.dto';

@ApiTags('subscription-payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('subscription/invoices/:invoiceId/payments')
export class SubscriptionInvoicePaymentsController {
  constructor(
    private readonly subscriptionPaymentsService: SubscriptionPaymentsService,
  ) {}

  @Post('order')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary:
      'Create a Razorpay payment order for a subscription invoice. Amount is always the invoice’s own total - never client-supplied. OWNER only.',
  })
  @ApiResponse({ status: 201, type: SubscriptionPaymentOrderResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Invoice is not payable (already PAID/VOID/DRAFT).',
  })
  async createOrder(
    @CurrentUser() user: AuthenticatedUser,
    @Param('invoiceId') invoiceId: string,
    @Body() dto: CreateSubscriptionPaymentOrderDto,
  ): Promise<SubscriptionPaymentOrderResponseDto> {
    return this.subscriptionPaymentsService.createOrder(user, invoiceId, dto);
  }
}

@ApiTags('subscription-payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/subscription/payments')
export class OrganizationSubscriptionPaymentsController {
  constructor(
    private readonly subscriptionPaymentsService: SubscriptionPaymentsService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'List this organization’s SaaS subscription payment history. OWNER only.',
  })
  @ApiResponse({ status: 200, type: [SubscriptionPaymentResponseDto] })
  async findForOrganization(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
  ): Promise<SubscriptionPaymentResponseDto[]> {
    return this.subscriptionPaymentsService.findForOrganization(
      user,
      organizationId,
    );
  }
}

@ApiTags('subscription-payments')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('subscription/payments')
export class SubscriptionPaymentsController {
  constructor(
    private readonly subscriptionPaymentsService: SubscriptionPaymentsService,
  ) {}

  @Get(':id')
  @ApiOperation({ summary: 'Get one subscription payment. OWNER only.' })
  @ApiResponse({ status: 200, type: SubscriptionPaymentResponseDto })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SubscriptionPaymentResponseDto> {
    return this.subscriptionPaymentsService.findOne(user, id);
  }

  @Post(':id/verify')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Independently verify a Razorpay Checkout callback and finalize the payment if genuine. OWNER only.',
  })
  @ApiResponse({ status: 200, type: SubscriptionPaymentResponseDto })
  @ApiResponse({ status: 400, description: 'Signature verification failed.' })
  async verify(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: VerifySubscriptionPaymentDto,
  ): Promise<SubscriptionPaymentResponseDto> {
    return this.subscriptionPaymentsService.verifyPayment(user, id, dto);
  }
}
