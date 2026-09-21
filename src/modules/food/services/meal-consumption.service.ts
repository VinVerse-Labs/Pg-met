import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { MembershipRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { PropertiesService } from '../../properties/properties.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CreateMealConsumptionDto } from '../dto/create-meal-consumption.dto';
import { ListMealConsumptionsQueryDto } from '../dto/list-meal-consumptions.query.dto';
import { MealConsumptionResponseDto } from '../dto/meal-consumption-response.dto';
import {
  PaginatedResult,
  paginationSkipTake,
} from '../../../common/dto/pagination-query.dto';

const MARK_ROLES: MembershipRole[] = ['OWNER', 'MANAGER', 'STAFF'];

// Staff-facing marking only in Phase 10 (spec: "do not implement
// biometric or QR attendance"). Every consumption row freezes what was
// actually served at the moment of marking (`itemNamesSnapshot`) - never
// re-read from the Menu later, so a subsequent menu edit can never
// rewrite a tenant's meal history (spec section 40).
@Injectable()
export class MealConsumptionService {
  private readonly logger = new Logger(MealConsumptionService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly properties: PropertiesService,
  ) {}

  async create(
    user: AuthenticatedUser,
    propertyId: string,
    dto: CreateMealConsumptionDto,
  ): Promise<MealConsumptionResponseDto> {
    const property = await this.properties.getAccessiblePropertyOrThrow(
      user,
      propertyId,
    );
    await this.assertMarkRole(user, property.organizationId);

    const residency = await this.prisma.residency.findFirst({
      where: { id: dto.residencyId, propertyId },
    });
    if (!residency) {
      throw new AppException(
        ErrorCode.RESIDENCY_NOT_FOUND,
        'Residency not found at this property.',
        HttpStatus.NOT_FOUND,
      );
    }

    let itemNamesSnapshot: string[] = [];
    let menuId: string | null = null;
    if (dto.menuId) {
      const menu = await this.prisma.menu.findFirst({
        where: { id: dto.menuId, propertyId },
        include: { items: { where: { mealType: dto.mealType } } },
      });
      if (menu) {
        menuId = menu.id;
        itemNamesSnapshot = menu.items.map((item) => item.name);
      }
    }

    let consumption;
    try {
      consumption = await this.prisma.mealConsumption.create({
        data: {
          organizationId: property.organizationId,
          propertyId,
          tenantId: residency.tenantId,
          residencyId: residency.id,
          menuId,
          mealType: dto.mealType,
          mealDate: new Date(dto.mealDate),
          itemNamesSnapshot,
          source: 'STAFF_MARKED',
          markedByUserId: user.id,
        },
      });
    } catch (error) {
      if (this.isUniqueViolation(error, ['meal_consumption_unique'])) {
        throw new AppException(
          ErrorCode.MEAL_ALREADY_RECORDED,
          'This meal has already been recorded for this resident.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    this.logger.log(
      `MEAL_CONSUMPTION_RECORDED consumption=${consumption.id} residency=${residency.id} by=${user.id}`,
    );
    return MealConsumptionResponseDto.fromEntity(consumption);
  }

  async findForProperty(
    user: AuthenticatedUser,
    propertyId: string,
    query: ListMealConsumptionsQueryDto,
  ): Promise<PaginatedResult<MealConsumptionResponseDto>> {
    await this.properties.getAccessiblePropertyOrThrow(user, propertyId);
    const { skip, take } = paginationSkipTake(query);
    const where: Prisma.MealConsumptionWhereInput = {
      propertyId,
      residencyId: query.residencyId,
      mealDate: {
        gte: query.from ? new Date(query.from) : undefined,
        lte: query.to ? new Date(query.to) : undefined,
      },
    };
    const [rows, total] = await Promise.all([
      this.prisma.mealConsumption.findMany({
        where,
        orderBy: { mealDate: 'desc' },
        skip,
        take,
      }),
      this.prisma.mealConsumption.count({ where }),
    ]);
    return {
      items: rows.map(MealConsumptionResponseDto.fromEntity),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  async findForTenant(
    user: AuthenticatedUser,
  ): Promise<MealConsumptionResponseDto[]> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { userId: user.id },
    });
    if (!tenant) {
      return [];
    }
    const rows = await this.prisma.mealConsumption.findMany({
      where: { tenantId: tenant.id },
      orderBy: { mealDate: 'desc' },
      take: 100,
    });
    return rows.map(MealConsumptionResponseDto.fromEntity);
  }

  private async assertMarkRole(
    user: AuthenticatedUser,
    organizationId: string,
  ): Promise<void> {
    if (user.platformRole === 'SUPER_ADMIN') {
      return;
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      organizationId,
    );
    this.memberships.assertRole(user, membership, MARK_ROLES);
  }

  private isUniqueViolation(error: unknown, candidates: string[]): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    const target = error.meta?.target;
    if (typeof target === 'string') {
      return candidates.some((c) => target === c || target.includes(c));
    }
    if (Array.isArray(target)) {
      return candidates.some((c) => target.includes(c));
    }
    return false;
  }
}
