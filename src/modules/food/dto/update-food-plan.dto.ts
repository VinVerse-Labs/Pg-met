import { ApiPropertyOptional } from '@nestjs/swagger';
import { MealType } from '@prisma/client';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

// Deliberately has no `price`/`currency`/`billingCycle` field - a price
// change is a new FoodPlan (create + archive the old one), never an
// in-place edit, the same convention SaasPlansService.adminUpdate already
// established (see its own doc comment: "historical...pricing must stay
// intact"). Enforced at the DTO boundary via the global ValidationPipe's
// `forbidNonWhitelisted`, not just by service logic.
export class UpdateFoodPlanDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: MealType, isArray: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(MealType, { each: true })
  mealTypes?: MealType[];
}
