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
import { UpdateResidencyDto } from './dto/update-residency.dto';
import { CheckInDto } from './dto/check-in.dto';
import { ResidencyResponseDto } from './dto/residency-response.dto';
import { ResidencyActionResponseDto } from './dto/residency-action-response.dto';

@ApiTags('residencies')
@ApiBearerAuth()
@Controller('residencies')
@UseGuards(JwtAuthGuard)
export class ResidenciesController {
  constructor(private readonly residenciesService: ResidenciesService) {}

  @Get(':id')
  @ApiOperation({
    summary:
      'Get one residency. 404 both when it does not exist and when it belongs to an organization the caller cannot access.',
  })
  @ApiResponse({ status: 200, type: ResidencyResponseDto })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ResidencyResponseDto> {
    return this.residenciesService.findOne(user, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      "Update the residency's expectedEndDate. This is the ONLY editable field - lifecycle state (status) can never be changed via PATCH, only via check-in/check-out.",
  })
  @ApiResponse({ status: 200, type: ResidencyResponseDto })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateResidencyDto,
  ): Promise<ResidencyResponseDto> {
    return this.residenciesService.update(user, id, dto);
  }

  @Post(':id/check-in')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      "Check a PENDING residency in: allocates the given bed and moves the residency to ACTIVE, atomically. The bed must belong to the residency's property (never trusted from the client beyond its id).",
  })
  @ApiResponse({ status: 200, type: ResidencyActionResponseDto })
  @ApiResponse({
    status: 409,
    description:
      'Wrong residency state, or the bed/room/property is not active/available.',
  })
  async checkIn(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: CheckInDto,
  ): Promise<ResidencyActionResponseDto> {
    return this.residenciesService.checkIn(user, id, dto);
  }

  @Post(':id/check-out')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Check an ACTIVE/NOTICE_PERIOD residency out: ends the active bed allocation and moves the residency to CHECKED_OUT, atomically. Never deletes allocation history.',
  })
  @ApiResponse({ status: 200, type: ResidencyActionResponseDto })
  @ApiResponse({
    status: 409,
    description:
      'Residency is not currently active (e.g. already checked out).',
  })
  async checkOut(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ResidencyActionResponseDto> {
    return this.residenciesService.checkOut(user, id);
  }
}
