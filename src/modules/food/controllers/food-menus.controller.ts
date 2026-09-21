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
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { FoodMenusService } from '../services/food-menus.service';
import { CreateMenuDto } from '../dto/create-menu.dto';
import { UpdateMenuDto } from '../dto/update-menu.dto';
import { CreateMenuItemDto } from '../dto/create-menu-item.dto';
import { UpdateMenuItemDto } from '../dto/update-menu-item.dto';
import { WeeklyMenuDto } from '../dto/weekly-menu.dto';
import { ListMenusQueryDto } from '../dto/list-menus.query.dto';
import { MenuResponseDto } from '../dto/menu-response.dto';

// Every menu mutation is date-scoped to a single Menu row (spec: "do not
// build a single mutable current menu table") - never a bulk operation
// that silently touches other dates, except the explicit weekly endpoints
// below, which are themselves transactional (spec section 27/34).
@ApiTags('food')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller()
export class FoodMenusController {
  constructor(private readonly menusService: FoodMenusService) {}

  @Post('properties/:propertyId/food/menus')
  @ApiOperation({
    summary: 'Create a DRAFT menu for one date. OWNER/MANAGER only.',
  })
  async createDaily(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Body() dto: CreateMenuDto,
  ): Promise<MenuResponseDto> {
    return this.menusService.createDaily(user, propertyId, dto);
  }

  @Get('properties/:propertyId/food/menus')
  @ApiOperation({
    summary:
      'List menus for this property (every status, incl. DRAFT). OWNER/MANAGER/STAFF.',
  })
  async findForProperty(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Query() query: ListMenusQueryDto,
  ): Promise<MenuResponseDto[]> {
    return this.menusService.findForProperty(user, propertyId, query);
  }

  @Get('properties/:propertyId/food/menus/week')
  @ApiOperation({
    summary: 'Get all menus for a 7-day window starting at startDate.',
  })
  async findWeek(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Query('startDate') startDate: string,
  ): Promise<MenuResponseDto[]> {
    return this.menusService.findWeekForProperty(user, propertyId, startDate);
  }

  @Put('properties/:propertyId/food/menus/week')
  @ApiOperation({
    summary:
      'Bulk create/update up to 7 days of menus in one atomic transaction. Never publishes; content-only.',
  })
  async putWeek(
    @CurrentUser() user: AuthenticatedUser,
    @Param('propertyId') propertyId: string,
    @Body() dto: WeeklyMenuDto,
  ): Promise<MenuResponseDto[]> {
    return this.menusService.putWeek(user, propertyId, dto);
  }

  @Get('food/menus/:id')
  @ApiOperation({ summary: 'Get one menu by id, with its items.' })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MenuResponseDto> {
    return this.menusService.findOneForOrg(user, id);
  }

  @Patch('food/menus/:id')
  @ApiOperation({
    summary:
      'Replace every item on this one DRAFT menu. Never affects any other date.',
  })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMenuDto,
  ): Promise<MenuResponseDto> {
    return this.menusService.replaceItems(user, id, dto.items);
  }

  @Post('food/menus/:id/publish')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'DRAFT -> PUBLISHED. Atomic; OWNER/MANAGER only.' })
  async publish(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MenuResponseDto> {
    return this.menusService.publish(user, id);
  }

  @Post('food/menus/:id/cancel')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Cancel a menu so it no longer appears as the available menu.',
  })
  async cancel(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<MenuResponseDto> {
    return this.menusService.cancel(user, id);
  }

  @Post('food/menus/:menuId/items')
  @ApiOperation({ summary: 'Add one item to a DRAFT menu.' })
  async addItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('menuId') menuId: string,
    @Body() dto: CreateMenuItemDto,
  ): Promise<MenuResponseDto> {
    return this.menusService.addItem(user, menuId, dto);
  }

  @Patch('food/menu-items/:id')
  @ApiOperation({ summary: 'Update one item on a DRAFT menu.' })
  async updateItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateMenuItemDto,
  ): Promise<MenuResponseDto> {
    return this.menusService.updateItem(user, id, dto);
  }

  @Delete('food/menu-items/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove one item from a DRAFT menu.' })
  async removeItem(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<void> {
    await this.menusService.removeItem(user, id);
  }
}
