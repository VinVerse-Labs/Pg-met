import { ApiProperty } from '@nestjs/swagger';
import {
  MealConsumption,
  MealConsumptionSource,
  MealType,
} from '@prisma/client';

export class MealConsumptionResponseDto {
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

  @ApiProperty({ nullable: true, type: String })
  menuId!: string | null;

  @ApiProperty({ enum: MealType })
  mealType!: MealType;

  @ApiProperty({ example: '2026-10-01' })
  mealDate!: string;

  @ApiProperty({ type: [String] })
  itemNamesSnapshot!: string[];

  @ApiProperty()
  consumedAt!: Date;

  @ApiProperty({ enum: MealConsumptionSource })
  source!: MealConsumptionSource;

  static fromEntity(entity: MealConsumption): MealConsumptionResponseDto {
    const dto = new MealConsumptionResponseDto();
    dto.id = entity.id;
    dto.organizationId = entity.organizationId;
    dto.propertyId = entity.propertyId;
    dto.tenantId = entity.tenantId;
    dto.residencyId = entity.residencyId;
    dto.menuId = entity.menuId;
    dto.mealType = entity.mealType;
    dto.mealDate = entity.mealDate.toISOString().slice(0, 10);
    dto.itemNamesSnapshot = entity.itemNamesSnapshot;
    dto.consumedAt = entity.consumedAt;
    dto.source = entity.source;
    return dto;
  }
}
