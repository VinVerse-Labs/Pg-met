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
import { InvoicesService } from './invoices.service';
import { InvoiceResponseDto } from './dto/invoice-response.dto';

@ApiTags('invoices')
@ApiBearerAuth()
@Controller('properties/:propertyId/invoices')
@UseGuards(JwtAuthGuard)
export class PropertyInvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get()
  @ApiOperation({
    summary:
      'List invoices across every residency at this property. Available to OWNER/MANAGER/STAFF (read-only financial access).',
  })
  @ApiResponse({ status: 200, type: [InvoiceResponseDto] })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
  ): Promise<InvoiceResponseDto[]> {
    return this.invoicesService.findAccessibleForProperty(user, propertyId);
  }
}
