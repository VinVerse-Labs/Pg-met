import {
  Body,
  Controller,
  Get,
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
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationResponseDto } from './dto/organization-response.dto';
import { OrganizationMembershipGuard } from './guards/organization-membership.guard';
import { MembershipRoleGuard } from './guards/membership-role.guard';
import { Roles } from './decorators/roles.decorator';
import { CurrentOrganization } from './decorators/current-organization.decorator';
import { CurrentMembership } from './decorators/current-membership.decorator';
import { Organization, OrganizationMembership } from '@prisma/client';

@ApiTags('organizations')
@ApiBearerAuth()
@Controller('organizations')
@UseGuards(JwtAuthGuard)
export class OrganizationsController {
  constructor(private readonly organizationsService: OrganizationsService) {}

  @Post()
  @ApiOperation({
    summary:
      'Create a new organization. The caller automatically becomes its OWNER - there is no other way to become an OWNER of a new organization.',
  })
  @ApiResponse({ status: 201, type: OrganizationResponseDto })
  async create(
    @CurrentUser() user: AuthenticatedUser,
    @Body() dto: CreateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsService.create(user, dto);
  }

  @Get()
  @ApiOperation({
    summary:
      'List organizations the caller belongs to (or every organization, for SUPER_ADMIN).',
  })
  @ApiResponse({ status: 200, type: [OrganizationResponseDto] })
  async findAccessible(
    @CurrentUser() user: AuthenticatedUser,
  ): Promise<OrganizationResponseDto[]> {
    return this.organizationsService.findAccessible(user);
  }

  @Get(':id')
  @UseGuards(OrganizationMembershipGuard)
  @ApiOperation({
    summary: 'Get one organization. Returns 404 if the caller is not a member.',
  })
  @ApiResponse({ status: 200, type: OrganizationResponseDto })
  @ApiResponse({
    status: 404,
    description: 'Not found, or not a member (indistinguishable).',
  })
  findOne(
    @CurrentOrganization() organization: Organization,
    @CurrentMembership() membership: OrganizationMembership | null,
  ): OrganizationResponseDto {
    return this.organizationsService.toResponse(organization, membership);
  }

  @Patch(':id')
  @UseGuards(OrganizationMembershipGuard, MembershipRoleGuard)
  @Roles('OWNER')
  @ApiOperation({ summary: 'Update organization details. OWNER only.' })
  @ApiResponse({ status: 200, type: OrganizationResponseDto })
  @ApiResponse({
    status: 403,
    description: 'Caller is a member but not an OWNER.',
  })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentMembership() membership: OrganizationMembership | null,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsService.update(id, dto, membership);
  }
}
