import { ApiProperty } from '@nestjs/swagger';
import {
  FoodSubscriptionStatus,
  MealType,
  TenantFoodSubscription,
} from '@prisma/client';

export class FoodSubscriptionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  propertyId!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty()
  residencyId!: string;

  @ApiProperty()
  foodPlanId!: string;

  @ApiProperty({ enum: FoodSubscriptionStatus })
  status!: FoodSubscriptionStatus;

  @ApiProperty()
  startDate!: Date;

  @ApiProperty({ nullable: true, type: Date })
  endDate!: Date | null;

  @ApiProperty()
  priceSnapshot!: string;

  @ApiProperty()
  currency!: string;

  @ApiProperty({ enum: MealType, isArray: true })
  mealTypesSnapshot!: MealType[];

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromEntity(
    entity: TenantFoodSubscription,
  ): FoodSubscriptionResponseDto {
    const dto = new FoodSubscriptionResponseDto();
    dto.id = entity.id;
    dto.organizationId = entity.organizationId;
    dto.propertyId = entity.propertyId;
    dto.tenantId = entity.tenantId;
    dto.residencyId = entity.residencyId;
    dto.foodPlanId = entity.foodPlanId;
    dto.status = entity.status;
    dto.startDate = entity.startDate;
    dto.endDate = entity.endDate;
    dto.priceSnapshot = entity.priceSnapshot.toString();
    dto.currency = entity.currency;
    dto.mealTypesSnapshot = entity.mealTypesSnapshot;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
