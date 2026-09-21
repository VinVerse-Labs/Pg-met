import { Body, Controller, Get, Param, Patch, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { FoodConfigurationService } from '../services/food-configuration.service';
import { UpdateFoodConfigurationDto } from '../dto/update-food-configuration.dto';
import { FoodConfigurationResponseDto } from '../dto/food-configuration-response.dto';

@ApiTags('food')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('properties/:propertyId/food')
export class FoodConfigurationController {
  constructor(private readonly configService: FoodConfigurationService) {}

  @Get()
  @ApiOperation({
    summary:
      'Read this property’s food configuration. Any active organization member (OWNER/MANAGER/STAFF) may view it.',
  })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
  ): Promise<FoodConfigurationResponseDto> {
    return this.configService.findForProperty(user, propertyId);
  }

  @Patch()
  @ApiOperation({
    summary:
      'Update food configuration (enabled, meals-included-in-rent, optional subscription). OWNER/MANAGER only.',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Body() dto: UpdateFoodConfigurationDto,
  ): Promise<FoodConfigurationResponseDto> {
    return this.configService.update(user, propertyId, dto);
  }
}
