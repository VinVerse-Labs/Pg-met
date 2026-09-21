import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { FoodPlansService } from '../services/food-plans.service';
import { CreateFoodPlanDto } from '../dto/create-food-plan.dto';
import { UpdateFoodPlanDto } from '../dto/update-food-plan.dto';
import { FoodPlanResponseDto } from '../dto/food-plan-response.dto';

@ApiTags('food')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class FoodPlansController {
  constructor(private readonly plansService: FoodPlansService) {}

  @Post('properties/:propertyId/food/plans')
  @ApiOperation({
    summary: 'Create a food plan at this property. OWNER/MANAGER only.',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Body() dto: CreateFoodPlanDto,
  ): Promise<FoodPlanResponseDto> {
    return this.plansService.create(user, propertyId, dto);
  }

  @Get('properties/:propertyId/food/plans')
  @ApiOperation({
    summary: 'List every food plan at this property, including ARCHIVED ones.',
  })
  async findForProperty(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
  ): Promise<FoodPlanResponseDto[]> {
    return this.plansService.findForProperty(user, propertyId);
  }

  @Get('food/plans/:id')
  @ApiOperation({ summary: 'Get one food plan by id.' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<FoodPlanResponseDto> {
    return this.plansService.findOne(user, id);
  }

  @Patch('food/plans/:id')
  @ApiOperation({
    summary:
      'Update a food plan’s name/description/mealTypes. price/currency/billingCycle can never change on an existing row - see UpdateFoodPlanDto.',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateFoodPlanDto,
  ): Promise<FoodPlanResponseDto> {
    return this.plansService.update(user, id, dto);
  }

  @Post('food/plans/:id/archive')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Retire a plan so it can no longer be newly subscribed to. Existing subscriptions/invoices keep referencing it.',
  })
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<FoodPlanResponseDto> {
    return this.plansService.archive(user, id);
  }
}
