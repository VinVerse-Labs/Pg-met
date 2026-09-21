import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { FoodSubscriptionsService } from '../services/food-subscriptions.service';
import { FoodSubscriptionResponseDto } from '../dto/food-subscription-response.dto';

// Direct id-based access, reachable by the subscribing tenant themselves
// or any active member of the owning organization (see
// FoodSubscriptionsService's BOLA doc comment) - the tenant-facing
// convenience wrapper is MyFoodController's /me/food/subscription*
// routes, which resolve the caller's own subscription id first and call
// these same service methods.
@ApiTags('food')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class FoodSubscriptionsController {
  constructor(
    private readonly subscriptionsService: FoodSubscriptionsService,
  ) {}

  @Get('properties/:propertyId/food/subscriptions')
  @ApiOperation({
    summary:
      'List every food subscription at this property. OWNER/MANAGER/STAFF.',
  })
  async findForProperty(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
  ): Promise<FoodSubscriptionResponseDto[]> {
    return this.subscriptionsService.findForProperty(user, propertyId);
  }

  @Get('food/subscriptions/:id')
  @ApiOperation({ summary: 'Get one food subscription by id.' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<FoodSubscriptionResponseDto> {
    return this.subscriptionsService.findOne(user, id);
  }

  @Post('food/subscriptions/:id/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'ACTIVE -> PAUSED.' })
  async pause(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<FoodSubscriptionResponseDto> {
    return this.subscriptionsService.pause(user, id);
  }

  @Post('food/subscriptions/:id/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'PAUSED -> ACTIVE.' })
  async resume(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<FoodSubscriptionResponseDto> {
    return this.subscriptionsService.resume(user, id);
  }

  @Post('food/subscriptions/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'ACTIVE|PAUSED -> CANCELLED. Historical invoices/payments are preserved.',
  })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<FoodSubscriptionResponseDto> {
    return this.subscriptionsService.cancel(user, id);
  }
}
