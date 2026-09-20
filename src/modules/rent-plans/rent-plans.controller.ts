import { Body, Controller, Param, Patch, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { RentPlansService } from './rent-plans.service';
import { UpdateRentPlanDto } from './dto/update-rent-plan.dto';
import { RentPlanResponseDto } from './dto/rent-plan-response.dto';

@ApiTags('rent-plans')
@ApiBearerAuth()
@Controller('rent-plans')
@UseGuards(JwtAuthGuard)
export class RentPlansController {
  constructor(private readonly rentPlansService: RentPlansService) {}

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update dueDay, or deactivate a rent plan. amount/effectiveFrom/currency are immutable - change rent via POST .../rent-plan instead.',
  })
  @ApiResponse({ status: 200, type: RentPlanResponseDto })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateRentPlanDto,
  ): Promise<RentPlanResponseDto> {
    return this.rentPlansService.update(user, id, dto);
  }
}
