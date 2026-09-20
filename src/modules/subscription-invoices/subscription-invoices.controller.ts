import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SubscriptionInvoicesService } from './subscription-invoices.service';
import { SubscriptionInvoiceResponseDto } from './dto/subscription-invoice-response.dto';

@ApiTags('subscription-invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/subscription/invoices')
export class OrganizationSubscriptionInvoicesController {
  constructor(
    private readonly subscriptionInvoicesService: SubscriptionInvoicesService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List this organization’s SaaS subscription invoices. OWNER only.',
  })
  @ApiResponse({ status: 200, type: [SubscriptionInvoiceResponseDto] })
  async findForOrganization(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
  ): Promise<SubscriptionInvoiceResponseDto[]> {
    return this.subscriptionInvoicesService.findForOrganization(
      user,
      organizationId,
    );
  }
}

@ApiTags('subscription-invoices')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('subscription/invoices')
export class SubscriptionInvoicesController {
  constructor(
    private readonly subscriptionInvoicesService: SubscriptionInvoicesService,
  ) {}

  @Get(':id')
  @ApiOperation({
    summary:
      '404 both when it does not exist and when it belongs to an organization the caller cannot access; 403 if the caller is a member but not OWNER.',
  })
  @ApiResponse({ status: 200, type: SubscriptionInvoiceResponseDto })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SubscriptionInvoiceResponseDto> {
    return this.subscriptionInvoicesService.findOne(user, id);
  }
}
