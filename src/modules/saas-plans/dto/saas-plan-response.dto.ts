import { ApiProperty } from '@nestjs/swagger';
import { SaasBillingInterval, SaasPlan, SaasPlanStatus } from '@prisma/client';

// Every monetary field is a decimal STRING, same convention as
// RentPlanResponseDto/InvoiceResponseDto.
export class SaasPlanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ example: '499.00' })
  price!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: SaasBillingInterval })
  billingInterval!: SaasBillingInterval;

  @ApiProperty({ enum: SaasPlanStatus })
  status!: SaasPlanStatus;

  static fromEntity(plan: SaasPlan): SaasPlanResponseDto {
    const dto = new SaasPlanResponseDto();
    dto.id = plan.id;
    dto.name = plan.name;
    dto.description = plan.description;
    dto.price = plan.price.toString();
    dto.currency = plan.currency;
    dto.billingInterval = plan.billingInterval;
    dto.status = plan.status;
    return dto;
  }
}
