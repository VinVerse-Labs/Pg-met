import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { SubscriptionsService } from './subscriptions.service';
import { ChangePlanDto } from './dto/change-plan.dto';
import { SubscriptionResponseDto } from './dto/subscription-response.dto';

@ApiTags('subscriptions')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('organizations/:organizationId/subscription')
export class SubscriptionsController {
  constructor(private readonly subscriptionsService: SubscriptionsService) {}

  @Get()
  @ApiOperation({
    summary:
      'Get this organization’s SaaS subscription (lazily provisioning a TRIAL one on first access). OWNER only.',
  })
  @ApiResponse({ status: 200, type: SubscriptionResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Not a member of that organization.',
  })
  @ApiResponse({
    status: 403,
    description: 'Member, but not OWNER (insufficient role).',
  })
  async getSubscription(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptionsService.getOrCreateForOrganization(
      user,
      organizationId,
    );
  }

  @Post('change-plan')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Schedule a plan change, effective at the next billing period. Never rewrites the current period’s already-issued invoice. OWNER only.',
  })
  @ApiResponse({ status: 200, type: SubscriptionResponseDto })
  async changePlan(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
    @Body() dto: ChangePlanDto,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptionsService.changePlan(user, organizationId, dto);
  }

  @Post('cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Cancel at period end - access and billing continue through the current paid period, then the subscription becomes CANCELLED. OWNER only.',
  })
  @ApiResponse({ status: 200, type: SubscriptionResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Already cancelled, or cancellation already requested.',
  })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('organizationId') organizationId: string,
  ): Promise<SubscriptionResponseDto> {
    return this.subscriptionsService.cancel(user, organizationId);
  }
}
