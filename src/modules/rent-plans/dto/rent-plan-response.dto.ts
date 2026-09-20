import { ApiProperty } from '@nestjs/swagger';
import { BillingCycle, RentPlan, RentPlanStatus } from '@prisma/client';

// `amount` is serialized as a decimal STRING (e.g. "8000.00"), never a JS
// number - the same reasoning as the request DTO: a JS number would
// reintroduce float imprecision on the way out, defeating the entire
// point of storing it as Decimal. Every money field in this API follows
// this convention - see README's "Phase 5" section.
export class RentPlanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  residencyId!: string;

  @ApiProperty({ example: '8000.00' })
  amount!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: BillingCycle })
  billingCycle!: BillingCycle;

  @ApiProperty()
  dueDay!: number;

  @ApiProperty()
  effectiveFrom!: Date;

  @ApiProperty({ nullable: true, type: Date })
  effectiveTo!: Date | null;

  @ApiProperty({ enum: RentPlanStatus })
  status!: RentPlanStatus;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(rentPlan: RentPlan): RentPlanResponseDto {
    const dto = new RentPlanResponseDto();
    dto.id = rentPlan.id;
    dto.residencyId = rentPlan.residencyId;
    dto.amount = rentPlan.amount.toString();
    dto.currency = rentPlan.currency;
    dto.billingCycle = rentPlan.billingCycle;
    dto.dueDay = rentPlan.dueDay;
    dto.effectiveFrom = rentPlan.effectiveFrom;
    dto.effectiveTo = rentPlan.effectiveTo;
    dto.status = rentPlan.status;
    dto.createdAt = rentPlan.createdAt;
    return dto;
  }
}
