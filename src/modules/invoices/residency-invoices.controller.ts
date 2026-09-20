import { Body, Controller, Post, UseGuards, Param } from '@nestjs/common';
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
import { GenerateInvoiceDto } from './dto/generate-invoice.dto';
import { InvoiceResponseDto } from './dto/invoice-response.dto';

// Nested under /residencies/:residencyId - generation is the one and only
// creation path (spec section 28), always scoped to a specific residency.
@ApiTags('invoices')
@ApiBearerAuth()
@Controller('residencies/:residencyId/invoices')
@UseGuards(JwtAuthGuard)
export class ResidencyInvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Post()
  @ApiOperation({
    summary:
      'Generate a DRAFT rent invoice for one calendar month. All financial fields (subtotal, proration, dueDate, invoice number) are computed server-side.',
  })
  @ApiResponse({ status: 201, type: InvoiceResponseDto })
  @ApiResponse({
    status: 409,
    description:
      'Duplicate billing period, or the rent plan changed mid-period.',
  })
  async generate(
    @CurrentUser() user: AuthenticatedUser,
    @Param('residencyId') residencyId: string,
    @Body() dto: GenerateInvoiceDto,
  ): Promise<InvoiceResponseDto> {
    return this.invoicesService.generateForResidency(user, residencyId, dto);
  }
}
