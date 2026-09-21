import { ApiPropertyOptional } from '@nestjs/swagger';
import { MealType } from '@prisma/client';
import {
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsEnum,
  IsOptional,
} from 'class-validator';

// PATCH-only - there is no separate "create" endpoint. The first GET or
// PATCH for a property lazily provisions a disabled-by-default row (see
// FoodConfigurationService.getOrCreateForProperty), the same lazy
// provisioning pattern Phase 7 uses for OrganizationSubscription.
export class UpdateFoodConfigurationDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  enabled?: boolean;

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  mealsIncludedInRent?: boolean;

  @ApiPropertyOptional({ enum: MealType, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsEnum(MealType, { each: true })
  includedMealTypes?: MealType[];

  @ApiPropertyOptional()
  @IsOptional()
  @IsBoolean()
  optionalSubscriptionEnabled?: boolean;
}
