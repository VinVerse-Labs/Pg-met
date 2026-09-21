import { Injectable } from '@nestjs/common';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { FoodConfigurationService } from './food-configuration.service';
import { FoodEntitlementService } from './food-entitlement.service';
import { FoodMenusService } from './food-menus.service';
import { FoodSubscriptionsService } from './food-subscriptions.service';
import { MyFoodResponseDto } from '../dto/my-food-response.dto';

// Orchestrates the other food services into the one tenant-dashboard
// payload (spec section 30/92: "the backend is the source of truth") -
// contains no authorization/business logic of its own beyond composing
// already-BOLA-safe calls, so there is exactly one place a future field
// gets added to the dashboard response.
@Injectable()
export class MyFoodService {
  constructor(
    private readonly foodConfiguration: FoodConfigurationService,
    private readonly entitlement: FoodEntitlementService,
    private readonly menus: FoodMenusService,
    private readonly subscriptions: FoodSubscriptionsService,
  ) {}

  async getDashboard(user: AuthenticatedUser): Promise<MyFoodResponseDto> {
    const { context, entitlement } =
      await this.entitlement.getEntitlementForCaller(user);
    const config = await this.foodConfiguration.getOrCreate(
      context.organizationId,
      context.property.id,
    );

    const todayDate = new Date().toISOString().slice(0, 10);
    const todayMenu = config.enabled
      ? await this.menus.findOneForDate(context.property.id, todayDate, true)
      : null;

    const dto = new MyFoodResponseDto();
    dto.enabled = config.enabled;
    dto.entitlement = entitlement;
    dto.today = todayMenu
      ? {
          date: todayMenu.date,
          status: todayMenu.status,
          meals: this.groupByMealType(todayMenu.items),
        }
      : null;

    dto.activeSubscriptionId =
      await this.subscriptions.findActiveIdForResidency(context.residency.id);
    return dto;
  }

  private groupByMealType(
    items: {
      mealType: string;
      name: string;
      description: string | null;
      isVegetarian: boolean;
      isAvailable: boolean;
    }[],
  ) {
    const byMealType = new Map<
      string,
      { name: string; description: string | null; isVegetarian: boolean }[]
    >();
    for (const item of items) {
      if (!item.isAvailable) continue;
      const list = byMealType.get(item.mealType) ?? [];
      list.push({
        name: item.name,
        description: item.description,
        isVegetarian: item.isVegetarian,
      });
      byMealType.set(item.mealType, list);
    }
    return [...byMealType.entries()].map(([mealType, groupItems]) => ({
      mealType: mealType as never,
      items: groupItems,
    }));
  }
}
