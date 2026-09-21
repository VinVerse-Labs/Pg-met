import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from '../../platform-admin/guards/platform-admin.guard';
import { PrismaService } from '../../../database/prisma.service';
import {
  PaginatedResult,
  PaginationQueryDto,
  paginationSkipTake,
} from '../../../common/dto/pagination-query.dto';
import { ListApplicationsQueryDto } from '../dto/list-applications.query.dto';
import { ApplicationResponseDto } from '../dto/application-response.dto';
import { VisitResponseDto } from '../dto/visit-response.dto';
import { ListingResponseDto } from '../dto/listing-response.dto';

// Global, read-only platform visibility - the same "Super Admin never
// gets arbitrary database mutation" posture PlatformAdminModule already
// established (see AdminComplaintsController). No write endpoint exists
// here.
@ApiTags('platform-admin: tenant discovery')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin')
export class AdminDiscoveryController {
  constructor(private readonly prisma: PrismaService) {}

  @Get('applications')
  @ApiOperation({
    summary: 'List every application on the platform. SUPER_ADMIN only.',
  })
  async listApplications(
    @Query() query: ListApplicationsQueryDto,
  ): Promise<PaginatedResult<ApplicationResponseDto>> {
    const { skip, take } = paginationSkipTake(query);
    const [rows, total] = await Promise.all([
      this.prisma.tenantApplication.findMany({
        where: {
          status: query.status,
          preferredRoomType: query.preferredRoomType,
        },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.tenantApplication.count({
        where: {
          status: query.status,
          preferredRoomType: query.preferredRoomType,
        },
      }),
    ]);
    return {
      items: rows.map(ApplicationResponseDto.fromEntity),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  @Get('visits')
  @ApiOperation({
    summary: 'List every property visit on the platform. SUPER_ADMIN only.',
  })
  async listVisits(
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<VisitResponseDto>> {
    const { skip, take } = paginationSkipTake(query);
    const [rows, total] = await Promise.all([
      this.prisma.propertyVisit.findMany({
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.propertyVisit.count(),
    ]);
    return {
      items: rows.map(VisitResponseDto.fromEntity),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  @Get('listings')
  @ApiOperation({
    summary: 'List every property listing on the platform. SUPER_ADMIN only.',
  })
  async listListings(
    @Query() query: PaginationQueryDto,
  ): Promise<PaginatedResult<ListingResponseDto>> {
    const { skip, take } = paginationSkipTake(query);
    const [rows, total] = await Promise.all([
      this.prisma.propertyListing.findMany({
        include: { amenities: true },
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.propertyListing.count(),
    ]);
    return {
      items: rows.map((r) => ListingResponseDto.fromEntity(r as never)),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }
}
