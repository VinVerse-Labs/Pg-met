import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MealConsumptionService } from '../services/meal-consumption.service';
import { CreateMealConsumptionDto } from '../dto/create-meal-consumption.dto';
import { ListMealConsumptionsQueryDto } from '../dto/list-meal-consumptions.query.dto';
import { MealConsumptionResponseDto } from '../dto/meal-consumption-response.dto';
import { PaginatedResult } from '../../../common/dto/pagination-query.dto';

@ApiTags('food')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class MealConsumptionController {
  constructor(private readonly consumptionService: MealConsumptionService) {}

  @Post('properties/:propertyId/food/meal-consumptions')
  @ApiOperation({
    summary: 'Mark that a resident had a meal. OWNER/MANAGER/STAFF only.',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Body() dto: CreateMealConsumptionDto,
  ): Promise<MealConsumptionResponseDto> {
    return this.consumptionService.create(user, propertyId, dto);
  }

  @Get('properties/:propertyId/food/meal-consumptions')
  @ApiOperation({ summary: 'List meal consumption records for this property.' })
  async findForProperty(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Query() query: ListMealConsumptionsQueryDto,
  ): Promise<PaginatedResult<MealConsumptionResponseDto>> {
    return this.consumptionService.findForProperty(user, propertyId, query);
  }
}
