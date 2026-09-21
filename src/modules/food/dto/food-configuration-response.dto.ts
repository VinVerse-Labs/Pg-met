import { ApiProperty } from '@nestjs/swagger';
import { FoodConfiguration, MealType } from '@prisma/client';

export class FoodConfigurationResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  propertyId!: string;

  @ApiProperty()
  enabled!: boolean;

  @ApiProperty()
  mealsIncludedInRent!: boolean;

  @ApiProperty({ enum: MealType, isArray: true })
  includedMealTypes!: MealType[];

  @ApiProperty()
  optionalSubscriptionEnabled!: boolean;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromEntity(entity: FoodConfiguration): FoodConfigurationResponseDto {
    const dto = new FoodConfigurationResponseDto();
    dto.id = entity.id;
    dto.organizationId = entity.organizationId;
    dto.propertyId = entity.propertyId;
    dto.enabled = entity.enabled;
    dto.mealsIncludedInRent = entity.mealsIncludedInRent;
    dto.includedMealTypes = entity.includedMealTypes;
    dto.optionalSubscriptionEnabled = entity.optionalSubscriptionEnabled;
    dto.createdAt = entity.createdAt;
    dto.updatedAt = entity.updatedAt;
    return dto;
  }
}
