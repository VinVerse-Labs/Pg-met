import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { BillingCycle, MealType } from '@prisma/client';
import {
  ArrayMinSize,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateFoodPlanDto {
  @ApiProperty({ example: 'Full Board' })
  @IsString()
  @MinLength(2)
  @MaxLength(200)
  name!: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({ enum: BillingCycle, default: 'MONTHLY' })
  @IsOptional()
  @IsEnum(BillingCycle)
  billingCycle?: BillingCycle;

  // A decimal string, never a JS number - the same convention
  // CreateSaasPlanDto.price uses.
  @ApiProperty({ example: '2500.00' })
  @Matches(/^\d{1,10}(\.\d{1,2})?$/, {
    message:
      'price must be a positive decimal string with up to 2 decimal places',
  })
  price!: string;

  @ApiPropertyOptional({ default: 'INR' })
  @IsOptional()
  @IsString()
  @MaxLength(3)
  currency?: string;

  @ApiProperty({ enum: MealType, isArray: true })
  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsEnum(MealType, { each: true })
  mealTypes!: MealType[];
}
