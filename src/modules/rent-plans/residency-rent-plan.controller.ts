import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
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
import { CreateRentPlanDto } from './dto/create-rent-plan.dto';
import { RentPlanResponseDto } from './dto/rent-plan-response.dto';

// Nested under /residencies/:residencyId, same convention as
// /properties/:propertyId/rooms - a rent plan is meaningless outside the
// residency it belongs to.
@ApiTags('rent-plans')
@ApiBearerAuth()
@Controller('residencies/:residencyId/rent-plan')
@UseGuards(JwtAuthGuard)
export class ResidencyRentPlanController {
  constructor(private readonly rentPlansService: RentPlansService) {}

  @Post()
  @ApiOperation({
    summary:
      "Set or change this residency's rent. If an ACTIVE plan already exists, it is closed out (effectiveTo set) and this becomes the new ACTIVE plan - history is never overwritten.",
  })
  @ApiResponse({ status: 201, type: RentPlanResponseDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('residencyId') residencyId: string,
    @Body() dto: CreateRentPlanDto,
  ): Promise<RentPlanResponseDto> {
    return this.rentPlansService.create(user, residencyId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'Get the current ACTIVE rent plan for this residency.',
  })
  @ApiResponse({ status: 200, type: RentPlanResponseDto })
  @ApiResponse({ status: 404, description: 'No active rent plan.' })
  async findCurrent(
    @CurrentUser() user: AuthenticatedUser,
    @Param('residencyId') residencyId: string,
  ): Promise<RentPlanResponseDto> {
    return this.rentPlansService.findCurrent(user, residencyId);
  }
}
