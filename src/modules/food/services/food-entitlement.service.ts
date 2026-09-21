import { HttpStatus, Injectable } from '@nestjs/common';
import { MealType, Property, Residency, Tenant } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { FoodConfigurationService } from './food-configuration.service';
import { FoodEntitlementResponseDto } from '../dto/food-entitlement-response.dto';

export interface TenantFoodContext {
  tenant: Tenant;
  residency: Residency;
  property: Property;
  organizationId: string;
}

// The central authority for "what food does this tenant actually
// receive right now" (spec section 16) - the only place
// includedMeals/subscriptionMeals are computed, so every caller (the
// /me/food dashboard, FoodSubscriptionsService's own validation) sees the
// identical, deduplicated answer.
@Injectable()
export class FoodEntitlementService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly foodConfiguration: FoodConfigurationService,
  ) {}

  // Authenticated User -> Tenant -> Residency -> Property -> Organization
  // (spec section 21/9) - the only path tenant food context is ever
  // resolved through. Never trusts a client-supplied tenantId/propertyId/
  // organizationId (spec: "do NOT trust arbitrary ... from tenant
  // clients").
  async getCallerResidencyContext(
    user: AuthenticatedUser,
  ): Promise<TenantFoodContext> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { userId: user.id },
    });
    if (!tenant) {
      throw new AppException(
        ErrorCode.TENANT_NOT_FOUND,
        'You must have a tenant profile to access food data.',
        HttpStatus.NOT_FOUND,
      );
    }
    const residency = await this.prisma.residency.findFirst({
      where: {
        tenantId: tenant.id,
        status: { in: ['ACTIVE', 'NOTICE_PERIOD'] },
      },
      include: { property: true },
      orderBy: { createdAt: 'desc' },
    });
    if (!residency) {
      throw new AppException(
        ErrorCode.RESIDENCY_NOT_FOUND,
        'You do not have a current residency.',
        HttpStatus.NOT_FOUND,
      );
    }
    return {
      tenant,
      residency,
      property: residency.property,
      organizationId: residency.property.organizationId,
    };
  }

  async getEntitlementForCaller(user: AuthenticatedUser): Promise<{
    context: TenantFoodContext;
    entitlement: FoodEntitlementResponseDto;
  }> {
    const context = await this.getCallerResidencyContext(user);
    const entitlement = await this.getEntitlementForResidency(
      context.organizationId,
      context.property.id,
      context.residency.id,
    );
    return { context, entitlement };
  }

  async getEntitlementForResidency(
    organizationId: string,
    propertyId: string,
    residencyId: string,
  ): Promise<FoodEntitlementResponseDto> {
    const config = await this.foodConfiguration.getOrCreate(
      organizationId,
      propertyId,
    );

    const dto = new FoodEntitlementResponseDto();
    if (!config.enabled) {
      dto.includedMeals = [];
      dto.subscriptionMeals = [];
      return dto;
    }

    const includedMeals = config.mealsIncludedInRent
      ? config.includedMealTypes
      : [];

    let subscriptionMeals: MealType[] = [];
    if (config.optionalSubscriptionEnabled) {
      const activeSubscription =
        await this.prisma.tenantFoodSubscription.findFirst({
          where: { residencyId, status: 'ACTIVE' },
        });
      if (activeSubscription) {
        // Never duplicate a meal already covered by rent (spec: "do not
        // duplicate meal entitlement") - the subscription may have been
        // purchased for a meal that later also became rent-included.
        subscriptionMeals = activeSubscription.mealTypesSnapshot.filter(
          (meal) => !includedMeals.includes(meal),
        );
      }
    }

    dto.includedMeals = includedMeals;
    dto.subscriptionMeals = subscriptionMeals;
    return dto;
  }
}
