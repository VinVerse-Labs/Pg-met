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
  Query,
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
import { PropertiesService } from './properties.service';
import { CreatePropertyDto } from './dto/create-property.dto';
import { UpdatePropertyDto } from './dto/update-property.dto';
import { ListPropertiesQueryDto } from './dto/list-properties.query.dto';
import { PropertyResponseDto } from './dto/property-response.dto';

// No route-param organization guard here (unlike OrganizationsController) -
// a property's organization is only known after loading the property row
// itself, so every authorization check lives in PropertiesService instead.
// See its docs, and spec section 20 ("avoid unrestricted repository
// methods... prefer findAccessibleProperty(userId, propertyId)").
@ApiTags('properties')
@ApiBearerAuth()
@Controller('properties')
@UseGuards(JwtAuthGuard)
export class PropertiesController {
  constructor(private readonly propertiesService: PropertiesService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a property under an organization. Requires an ACTIVE OWNER or MANAGER membership in that organization - organizationId alone grants nothing.',
  })
  @ApiResponse({ status: 201, type: PropertyResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Not a member of that organization.',
  })
  @ApiResponse({
    status: 403,
    description: 'Member, but STAFF (insufficient role).',
  })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreatePropertyDto,
  ): Promise<PropertyResponseDto> {
    return this.propertiesService.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'List properties across every organization the caller belongs to, or one organization via ?organizationId=.',
  })
  @ApiResponse({ status: 200, type: [PropertyResponseDto] })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListPropertiesQueryDto,
  ): Promise<PropertyResponseDto[]> {
    return this.propertiesService.findAccessible(user, query.organizationId);
  }

  @Get(':id')
  @ApiOperation({
    summary:
      'Get one property. Returns 404 both when it does not exist and when it belongs to an organization the caller cannot access - the two are indistinguishable by design (BOLA/IDOR protection).',
  })
  @ApiResponse({ status: 200, type: PropertyResponseDto })
  @ApiResponse({ status: 404 })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PropertyResponseDto> {
    return this.propertiesService.findOne(user, id);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Update a property. OWNER or MANAGER only.' })
  @ApiResponse({ status: 200, type: PropertyResponseDto })
  async update(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdatePropertyDto,
  ): Promise<PropertyResponseDto> {
    return this.propertiesService.update(user, id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Archive a property (soft delete - sets status to ARCHIVED, never a hard delete). OWNER only.',
  })
  @ApiResponse({ status: 200, type: PropertyResponseDto })
  async archive(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<PropertyResponseDto> {
    return this.propertiesService.archive(user, id);
  }
}
