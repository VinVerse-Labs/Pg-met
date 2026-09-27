import { ApiProperty } from '@nestjs/swagger';
import { MealType, MenuStatus } from '@prisma/client';
import { FoodEntitlementResponseDto } from './food-entitlement-response.dto';

export class MenuMealItemDto {
  @ApiProperty()
  name!: string;

  @ApiProperty({ nullable: true, type: String })
  description!: string | null;

  @ApiProperty()
  isVegetarian!: boolean;
}

export class MenuMealGroupDto {
  @ApiProperty({ enum: MealType })
  mealType!: MealType;

  @ApiProperty({ type: [MenuMealItemDto] })
  items!: MenuMealItemDto[];
}

export class TodayMenuDto {
  @ApiProperty({ example: '2026-09-21' })
  date!: string;

  @ApiProperty({ enum: MenuStatus })
  status!: MenuStatus;

  @ApiProperty({ type: [MenuMealGroupDto] })
  meals!: MenuMealGroupDto[];
}

// The single tenant-dashboard payload (spec section 30) - always the
// backend's current, published view; never anything the client is
// expected to cache/compute itself (spec section 92: "the backend is the
// source of truth").
export class MyFoodResponseDto {
  @ApiProperty()
  enabled!: boolean;

  @ApiProperty({
    example: '2026-09-21',
    description:
      "Today's calendar date at the property (its own timezone) - the anchor for 'today' and menu weeks.",
  })
  todayDate!: string;

  @ApiProperty({ example: 'Asia/Kolkata' })
  timezone!: string;

  @ApiProperty({ type: FoodEntitlementResponseDto })
  entitlement!: FoodEntitlementResponseDto;

  @ApiProperty({ type: TodayMenuDto, nullable: true })
  today!: TodayMenuDto | null;

  @ApiProperty({ nullable: true, type: String })
  activeSubscriptionId!: string | null;
}
