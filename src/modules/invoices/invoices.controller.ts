import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
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
import { InvoicesService } from './invoices.service';
import { UpdateInvoiceDto } from './dto/update-invoice.dto';
import { InvoiceResponseDto } from './dto/invoice-response.dto';

@ApiTags('invoices')
@ApiBearerAuth()
@Controller('invoices')
@UseGuards(JwtAuthGuard)
export class InvoicesController {
  constructor(private readonly invoicesService: InvoicesService) {}

  @Get(':id')
  @ApiOperation({
    summary:
      'Get one invoice. 404 both when it does not exist and when it belongs to an organization the caller cannot access. An ISSUED invoice past its dueDate is lazily transitioned to OVERDUE on read.',
  })
  @ApiResponse({ status: 200, type: InvoiceResponseDto })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<InvoiceResponseDto> {
    return this.invoicesService.findOne(user, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      "Update an invoice's dueDate. DRAFT invoices only - every financial field is immutable once issued.",
  })
  @ApiResponse({ status: 200, type: InvoiceResponseDto })
  @ApiResponse({ status: 409, description: 'Invoice is not DRAFT.' })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateInvoiceDto,
  ): Promise<InvoiceResponseDto> {
    return this.invoicesService.update(user, id, dto);
  }

  @Post(':id/issue')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Issue a DRAFT invoice, turning it into an immutable financial snapshot.',
  })
  @ApiResponse({ status: 200, type: InvoiceResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Already issued, or already voided.',
  })
  async issue(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<InvoiceResponseDto> {
    return this.invoicesService.issue(user, id);
  }

  @Post(':id/void')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Void an invoice (DRAFT, ISSUED, or OVERDUE). Terminal - a corrected invoice is a new one, never a re-issued one.',
  })
  @ApiResponse({ status: 200, type: InvoiceResponseDto })
  @ApiResponse({ status: 409, description: 'Already voided.' })
  async voidInvoice(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<InvoiceResponseDto> {
    return this.invoicesService.voidInvoice(user, id);
  }
}
