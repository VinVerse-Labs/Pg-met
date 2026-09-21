import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { MealType } from '@prisma/client';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';

// Staff-facing only in Phase 10 (spec: "do not implement biometric or QR
// attendance") - `residencyId` names which resident, never a bare
// `tenantId`, so the meal-period uniqueness constraint
// (residencyId, mealDate, mealType) has an unambiguous scope even across
// a tenant's multiple residencies over time.
export class CreateMealConsumptionDto {
  @ApiProperty()
  @IsUUID()
  residencyId!: string;

  @ApiProperty({ enum: MealType })
  @IsEnum(MealType)
  mealType!: MealType;

  @ApiProperty({ example: '2026-10-01', description: 'YYYY-MM-DD' })
  @IsDateString()
  mealDate!: string;

  @ApiPropertyOptional({
    description:
      'The published menu this consumption is against, if one exists for this property/date.',
  })
  @IsOptional()
  @IsUUID()
  menuId?: string;
}
