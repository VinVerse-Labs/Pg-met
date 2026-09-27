import { Controller, Get, Param, Query, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import {
  PaginatedResult,
  PaginationQueryDto,
} from '../../../common/dto/pagination-query.dto';
import { MyStayService } from '../services/my-stay.service';
import { MyBillingService } from '../services/my-billing.service';
import { MyStayResponseDto } from '../dto/my-stay-response.dto';
import { ListMyInvoicesQueryDto } from '../dto/list-my-invoices.query.dto';
import {
  MyInvoiceDetailDto,
  MyInvoiceDto,
  MyPaymentDto,
  MyRentSummaryDto,
} from '../dto/my-invoice-response.dto';

// The tenant's own stay + rent billing (Tenant Web Phase 2). Read-only and
// always resolved from the authenticated caller - no tenantId/residencyId
// is ever accepted. Paying still goes through the existing
// POST /invoices/:invoiceId/payments/order + POST /payments/:id/verify.
@ApiTags('me: stay & rent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me')
export class MeBillingController {
  constructor(
    private readonly stay: MyStayService,
    private readonly billing: MyBillingService,
  ) {}

  @Get('residency')
  @ApiOperation({
    summary:
      "The caller's current stay (ACTIVE/NOTICE_PERIOD, else an upcoming PENDING one) with property, room, bed and active rent plan; null when there is none.",
  })
  @ApiResponse({ status: 200, type: MyStayResponseDto })
  async getStay(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MyStayResponseDto | null> {
    return this.stay.findCurrent(user);
  }

  @Get('rent')
  @ApiOperation({
    summary:
      'Rent summary: outstanding balance per currency, open/overdue counts and the next payable invoice.',
  })
  @ApiResponse({ status: 200, type: MyRentSummaryDto })
  async getRentSummary(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MyRentSummaryDto> {
    return this.billing.getRentSummary(user);
  }

  @Get('invoices')
  @ApiOperation({
    summary:
      "The caller's own rent invoices (never DRAFT), newest billing period first, with amountPaid/balanceDue/isPayable.",
  })
  async listInvoices(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListMyInvoicesQueryDto,
  ): Promise<PaginatedResult<MyInvoiceDto>> {
    return this.billing.listInvoices(user, query);
  }

  @Get('invoices/:id')
  @ApiOperation({
    summary:
      "One of the caller's own invoices with line items and their payments. 404 for anyone else's.",
  })
  @ApiResponse({ status: 200, type: MyInvoiceDetailDto })
  async getInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MyInvoiceDetailDto> {
    return this.billing.getInvoice(user, id);
  }

  @Get('payments')
  @ApiOperation({
    summary:
      "The caller's own rent payments, newest first (tenant-safe fields only).",
  })
  async listPayments(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<MyPaymentDto>> {
    return this.billing.listPayments(user, query);
  }
}
