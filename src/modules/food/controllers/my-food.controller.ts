import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MyFoodService } from '../services/my-food.service';
import { FoodEntitlementService } from '../services/food-entitlement.service';
import { FoodPlansService } from '../services/food-plans.service';
import { FoodSubscriptionsService } from '../services/food-subscriptions.service';
import { FoodMenusService } from '../services/food-menus.service';
import { FoodBillingService } from '../services/food-billing.service';
import { MealConsumptionService } from '../services/meal-consumption.service';
import { CreateFoodSubscriptionDto } from '../dto/create-food-subscription.dto';
import { FoodSubscriptionResponseDto } from '../dto/food-subscription-response.dto';
import { FoodPlanResponseDto } from '../dto/food-plan-response.dto';
import { FoodEntitlementResponseDto } from '../dto/food-entitlement-response.dto';
import { FoodSubscriptionInvoiceResponseDto } from '../dto/food-subscription-invoice-response.dto';
import { MenuResponseDto } from '../dto/menu-response.dto';
import { MyFoodResponseDto } from '../dto/my-food-response.dto';
import { MealConsumptionResponseDto } from '../dto/meal-consumption-response.dto';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';

// The tenant-facing dashboard surface (spec sections 20/30/31/50/92) -
// every route here resolves the caller's own tenant/residency/property
// context server-side; none ever accepts a tenantId/propertyId/
// subscriptionId from the client (spec section 21).
@ApiTags('food')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/food')
export class MyFoodController {
  constructor(
    private readonly myFood: MyFoodService,
    private readonly entitlement: FoodEntitlementService,
    private readonly plans: FoodPlansService,
    private readonly subscriptions: FoodSubscriptionsService,
    private readonly menus: FoodMenusService,
    private readonly billing: FoodBillingService,
    private readonly consumption: MealConsumptionService,
  ) {}

  @Get()
  @ApiOperation({
    summary:
      'The composed tenant dashboard payload: enabled, entitlement, today’s published menu, active subscription id.',
  })
  async getDashboard(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MyFoodResponseDto> {
    return this.myFood.getDashboard(user);
  }

  @Get('entitlement')
  @ApiOperation({
    summary:
      'includedMeals vs subscriptionMeals for the caller’s current residency.',
  })
  async getEntitlement(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FoodEntitlementResponseDto> {
    const { entitlement } =
      await this.entitlement.getEntitlementForCaller(user);
    return entitlement;
  }

  @Get('plans')
  @ApiOperation({
    summary: 'ACTIVE food plans available at the caller’s current property.',
  })
  async getPlans(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FoodPlanResponseDto[]> {
    const { context } = await this.entitlement.getEntitlementForCaller(user);
    return this.plans.findActiveForProperty(context.property.id);
  }

  @Get('subscription')
  @ApiOperation({
    summary: 'The caller’s own active food subscription, or null.',
  })
  async getSubscription(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FoodSubscriptionResponseDto | null> {
    return this.subscriptions.findMyActive(user);
  }

  @Post('subscriptions')
  @ApiOperation({
    summary:
      'Subscribe to an optional food plan at the caller’s current property.',
  })
  async subscribe(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateFoodSubscriptionDto,
  ): Promise<FoodSubscriptionResponseDto> {
    return this.subscriptions.subscribe(user, dto);
  }

  @Post('subscription/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Pause the caller’s own active food subscription.' })
  async pause(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FoodSubscriptionResponseDto> {
    const id = await this.requireMySubscriptionId(user);
    return this.subscriptions.pause(user, id);
  }

  @Post('subscription/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Resume the caller’s own paused food subscription.',
  })
  async resume(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FoodSubscriptionResponseDto> {
    const id = await this.requireMySubscriptionId(user);
    return this.subscriptions.resume(user, id);
  }

  @Post('subscription/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Cancel the caller’s own food subscription.' })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FoodSubscriptionResponseDto> {
    const id = await this.requireMySubscriptionId(user);
    return this.subscriptions.cancel(user, id);
  }

  @Get('invoices')
  @ApiOperation({
    summary: 'The caller’s own food subscription invoices, newest first.',
  })
  async getInvoices(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<FoodSubscriptionInvoiceResponseDto[]> {
    return this.billing.findInvoicesForTenant(user);
  }

  @Get('menu')
  @ApiOperation({
    summary:
      'Today’s published menu at the caller’s current property, or null.',
  })
  async getTodayMenu(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MenuResponseDto | null> {
    const { context } = await this.entitlement.getEntitlementForCaller(user);
    const today = new Date().toISOString().slice(0, 10);
    return this.menus.findOneForDate(context.property.id, today, true);
  }

  @Get('menu/week')
  @ApiOperation({
    summary:
      'PUBLISHED menus for a 7-day window starting at startDate, at the caller’s current property. Never returns DRAFT.',
  })
  async getWeekMenu(
    @CurrentUser() user: AuthenticatedUser,
    @Query('startDate') startDate: string,
  ): Promise<MenuResponseDto[]> {
    const { context } = await this.entitlement.getEntitlementForCaller(user);
    return this.menus.findWeekRows(context.property.id, startDate, true);
  }

  @Get('meals')
  @ApiOperation({ summary: 'The caller’s own recorded meal history.' })
  async getMealHistory(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<MealConsumptionResponseDto[]> {
    return this.consumption.findForTenant(user);
  }

  // pause/resume/cancel act on "my subscription" without an id in the
  // URL - resolved here (ACTIVE or PAUSED, so resume can find a
  // currently-paused one) rather than duplicating
  // FoodSubscriptionsService's own BOLA/state logic.
  private async requireMySubscriptionId(
    user: AuthenticatedUser,
  ): Promise<string> {
    const { context } = await this.entitlement.getEntitlementForCaller(user);
    const id = await this.subscriptions.findNonTerminalIdForResidency(
      context.residency.id,
    );
    if (!id) {
      throw new AppException(
        ErrorCode.FOOD_SUBSCRIPTION_NOT_FOUND,
        'You have no food subscription to act on.',
        HttpStatus.NOT_FOUND,
      );
    }
    return id;
  }
}
