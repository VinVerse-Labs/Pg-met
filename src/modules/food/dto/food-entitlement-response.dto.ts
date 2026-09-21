import { ApiProperty } from '@nestjs/swagger';
import { MealType } from '@prisma/client';

// Spec section 16: two never-overlapping arrays. A meal type present in
// `includedMeals` is always excluded from `subscriptionMeals`, even if the
// tenant's paid plan also nominally covers it (spec: "do not duplicate
// meal entitlement").
export class FoodEntitlementResponseDto {
  @ApiProperty({ enum: MealType, isArray: true })
  includedMeals!: MealType[];

  @ApiProperty({ enum: MealType, isArray: true })
  subscriptionMeals!: MealType[];
}
