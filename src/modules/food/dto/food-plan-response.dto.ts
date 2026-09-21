import { ApiProperty } from '@nestjs/swagger';
import {
  BillingCycle,
  FoodPlan,
  FoodPlanStatus,
  MealType,
} from '@prisma/client';

export class FoodPlanResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  propertyId!: string;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty({ enum: FoodPlanStatus })
  status!: FoodPlanStatus;

  @ApiProperty({ enum: BillingCycle })
  billingCycle!: BillingCycle;

  @ApiProperty()
  price!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: MealType, isArray: true })
  mealTypes!: MealType[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromEntity(entity: FoodPlan): FoodPlanResponseDto {
    const dto = new FoodPlanResponseDto();
    dto.id = entity.id;
    dto.organizationId = entity.organizationId;
    dto.propertyId = entity.propertyId;
    dto.name = entity.name;
    dto.description = entity.description;
    dto.status = entity.status;
    dto.billingCycle = entity.billingCycle;
    dto.price = entity.price.toString();
    dto.currency = entity.currency;
    dto.mealTypes = entity.mealTypes;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
