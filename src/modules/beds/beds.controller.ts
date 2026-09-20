import {
  Body,
  Controller,
  Delete,
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
import { BedsService } from './beds.service';
import { CreateBedDto } from './dto/create-bed.dto';
import { UpdateBedDto } from './dto/update-bed.dto';
import { BedResponseDto } from './dto/bed-response.dto';

// Nested three levels deep (/properties/:propertyId/rooms/:roomId/beds) so
// every route always carries the full chain the URL claims - BedsService
// verifies all of it server-side rather than trusting any single id.
@ApiTags('beds')
@ApiBearerAuth()
@Controller('properties/:propertyId/rooms/:roomId/beds')
@UseGuards(JwtAuthGuard)
export class BedsController {
  constructor(private readonly bedsService: BedsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a bed in a room. Requires OWNER/MANAGER, an ACTIVE property, an ACTIVE room, and the room must not already be at capacity.',
  })
  @ApiResponse({ status: 201, type: BedResponseDto })
  @ApiResponse({
    status: 409,
    description: 'Room is at capacity, or the room/property is not active.',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Param('roomId') roomId: string,
    @Body() dto: CreateBedDto,
  ): Promise<BedResponseDto> {
    return this.bedsService.create(user, propertyId, roomId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List beds in a room the caller can access.' })
  @ApiResponse({ status: 200, type: [BedResponseDto] })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Param('roomId') roomId: string,
  ): Promise<BedResponseDto[]> {
    return this.bedsService.findAccessible(user, propertyId, roomId);
  }

  @Get(':bedId')
  @ApiOperation({
    summary:
      'Get one bed. 404 both when it does not exist and when the room/property/organization chain does not match.',
  })
  @ApiResponse({ status: 200, type: BedResponseDto })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Param('roomId') roomId: string,
    @Param('bedId') bedId: string,
  ): Promise<BedResponseDto> {
    return this.bedsService.findOne(user, propertyId, roomId, bedId);
  }

  @Patch(':bedId')
  @ApiOperation({
    summary:
      'Update a bed (bedNumber and/or status - AVAILABLE/INACTIVE only, never ARCHIVED). OWNER or MANAGER only.',
  })
  @ApiResponse({ status: 200, type: BedResponseDto })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Param('roomId') roomId: string,
    @Param('bedId') bedId: string,
    @Body() dto: UpdateBedDto,
  ): Promise<BedResponseDto> {
    return this.bedsService.update(user, propertyId, roomId, bedId, dto);
  }

  @Delete(':bedId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archive a bed (soft delete - never a hard delete). OWNER only.',
  })
  @ApiResponse({ status: 200, type: BedResponseDto })
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Param('roomId') roomId: string,
    @Param('bedId') bedId: string,
  ): Promise<BedResponseDto> {
    return this.bedsService.archive(user, propertyId, roomId, bedId);
  }
}
