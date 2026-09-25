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
import { RoomsService } from './rooms.service';
import { CreateRoomDto } from './dto/create-room.dto';
import { UpdateRoomDto } from './dto/update-room.dto';
import { RoomResponseDto } from './dto/room-response.dto';
import { RoomHistoryEntryDto } from './dto/room-history.dto';

// Nested under /properties/:propertyId (no separate top-level /rooms route)
// - a room is meaningless outside the property it belongs to, and nesting
// the route means :propertyId is always present for RoomsService to scope
// through, exactly as spec section 7 asks for.
@ApiTags('rooms')
@ApiBearerAuth()
@Controller('properties/:propertyId/rooms')
@UseGuards(JwtAuthGuard)
export class RoomsController {
  constructor(private readonly roomsService: RoomsService) {}

  @Post()
  @ApiOperation({
    summary:
      "Create a room in a property. Requires an ACTIVE OWNER or MANAGER membership in that property's organization, and the property itself must be ACTIVE.",
  })
  @ApiResponse({ status: 201, type: RoomResponseDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Body() dto: CreateRoomDto,
  ): Promise<RoomResponseDto> {
    return this.roomsService.create(user, propertyId, dto);
  }

  @Get()
  @ApiOperation({ summary: 'List rooms in a property the caller can access.' })
  @ApiResponse({ status: 200, type: [RoomResponseDto] })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
  ): Promise<RoomResponseDto[]> {
    return this.roomsService.findAccessible(user, propertyId);
  }

  @Get(':roomId')
  @ApiOperation({
    summary:
      'Get one room. 404 both when it does not exist and when it belongs to a property/organization the caller cannot access.',
  })
  @ApiResponse({ status: 200, type: RoomResponseDto })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Param('roomId') roomId: string,
  ): Promise<RoomResponseDto> {
    return this.roomsService.findOne(user, propertyId, roomId);
  }

  @Get(':roomId/history')
  @ApiOperation({
    summary:
      "Bed-allocation history (check-ins/check-outs) for a room's beds, newest first, max 100. Any active member who can see the room.",
  })
  @ApiResponse({ status: 200, type: [RoomHistoryEntryDto] })
  async history(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Param('roomId') roomId: string,
  ): Promise<RoomHistoryEntryDto[]> {
    return this.roomsService.history(user, propertyId, roomId);
  }

  @Patch(':roomId')
  @ApiOperation({ summary: 'Update a room. OWNER or MANAGER only.' })
  @ApiResponse({ status: 200, type: RoomResponseDto })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Param('roomId') roomId: string,
    @Body() dto: UpdateRoomDto,
  ): Promise<RoomResponseDto> {
    return this.roomsService.update(user, propertyId, roomId, dto);
  }

  @Delete(':roomId')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Archive a room (soft delete - never a hard delete). OWNER only.',
  })
  @ApiResponse({ status: 200, type: RoomResponseDto })
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Param('roomId') roomId: string,
  ): Promise<RoomResponseDto> {
    return this.roomsService.archive(user, propertyId, roomId);
  }
}
