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
import { ResidenciesService } from './residencies.service';
import { CreateResidencyDto } from './dto/create-residency.dto';
import { ResidencyResponseDto } from './dto/residency-response.dto';

// Nested under /properties/:propertyId, same convention as Rooms/Beds -
// creating and listing residencies are property-scoped operational
// actions. Everything else (GET one, PATCH, check-in, check-out) lives on
// the top-level ResidenciesController, since a residency id alone is
// enough to identify it once it exists (see that controller's docs).
@ApiTags('residencies')
@ApiBearerAuth()
@Controller('properties/:propertyId/residencies')
@UseGuards(JwtAuthGuard)
export class PropertyResidenciesController {
  constructor(private readonly residenciesService: ResidenciesService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a residency (PENDING) for an existing tenant at this property. Does NOT allocate a bed - see POST /residencies/:id/check-in.',
  })
  @ApiResponse({ status: 201, type: ResidencyResponseDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Body() dto: CreateResidencyDto,
  ): Promise<ResidencyResponseDto> {
    return this.residenciesService.create(user, propertyId, dto);
  }

  @Get()
  @ApiOperation({
    summary: 'List residencies at a property the caller can access.',
  })
  @ApiResponse({ status: 200, type: [ResidencyResponseDto] })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
  ): Promise<ResidencyResponseDto[]> {
    return this.residenciesService.findAccessibleForProperty(user, propertyId);
  }
}
