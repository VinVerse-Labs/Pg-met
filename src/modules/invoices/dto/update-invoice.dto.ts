import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

// The ONLY field a PATCH may change, and only while the invoice is still
// DRAFT (InvoicesService.update enforces this). No subtotal/discount/tax
// /total/items/invoiceNumber/billingPeriod field exists here - once
// issued, an invoice is a financial snapshot (spec section 17); a client
// can never PATCH those, not even while DRAFT, since every one of them is
// server-calculated and re-deriving them from a partial client PATCH
// would reopen exactly the "who's authoritative for money" question
// Phase 5 closes (spec section 35).
export class UpdateInvoiceDto {
  @ApiProperty({
    description: 'Revised due date (ISO 8601). DRAFT invoices only.',
  })
  @IsDateString()
  dueDate!: string;
}
