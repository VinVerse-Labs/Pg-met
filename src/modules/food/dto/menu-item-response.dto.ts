import { ApiProperty } from '@nestjs/swagger';
import { MealType, MenuItem } from '@prisma/client';

export class MenuItemResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  menuId!: string;

  @ApiProperty({ enum: MealType })
  mealType!: MealType;

  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty()
  isVegetarian!: boolean;

  @ApiProperty()
  isAvailable!: boolean;

  static fromEntity(entity: MenuItem): MenuItemResponseDto {
    const dto = new MenuItemResponseDto();
    dto.id = entity.id;
    dto.menuId = entity.menuId;
    dto.mealType = entity.mealType;
    dto.name = entity.name;
    dto.description = entity.description;
    dto.isVegetarian = entity.isVegetarian;
    dto.isAvailable = entity.isAvailable;
    return dto;
  }
}
