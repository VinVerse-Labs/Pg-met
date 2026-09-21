import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { FoodPlan, MembershipRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { PropertiesService } from '../../properties/properties.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CreateFoodPlanDto } from '../dto/create-food-plan.dto';
import { UpdateFoodPlanDto } from '../dto/update-food-plan.dto';
import { FoodPlanResponseDto } from '../dto/food-plan-response.dto';

const MANAGE_ROLES: MembershipRole[] = ['OWNER', 'MANAGER'];

// A property-scoped billable food tier (spec section 12-13). Price is
// set once at creation and never mutated afterward (see UpdateFoodPlanDto's
// own doc comment) - a price change is archive-the-old, create-a-new,
// the same convention SaasPlansService already established for Phase 7.
@Injectable()
export class FoodPlansService {
  private readonly logger = new Logger(FoodPlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly properties: PropertiesService,
    private readonly auditLog: AuditLogService,
  ) {}

  async create(
    user: AuthenticatedUser,
    propertyId: string,
    dto: CreateFoodPlanDto,
  ): Promise<FoodPlanResponseDto> {
    const property = await this.properties.getAccessiblePropertyOrThrow(
      user,
      propertyId,
    );
    await this.assertManageRole(user, property.organizationId);

    const plan = await this.prisma.foodPlan.create({
      data: {
        organizationId: property.organizationId,
        propertyId,
        name: dto.name,
        description: dto.description,
        billingCycle: dto.billingCycle,
        price: new Prisma.Decimal(dto.price),
        currency: dto.currency ?? 'INR',
        mealTypes: dto.mealTypes,
      },
    });
    this.logger.log(
      `FOOD_PLAN_CREATED plan=${plan.id} property=${propertyId} by=${user.id}`,
    );
    await this.auditLog.record({
      actorUserId: user.id,
      action: 'FOOD_PLAN_CREATED',
      entityType: 'FoodPlan',
      entityId: plan.id,
      organizationId: property.organizationId,
      metadata: {
        propertyId,
        name: plan.name,
        billingCycle: plan.billingCycle,
      },
    });
    return FoodPlanResponseDto.fromEntity(plan);
  }

  async findForProperty(
    user: AuthenticatedUser,
    propertyId: string,
  ): Promise<FoodPlanResponseDto[]> {
    await this.properties.getAccessiblePropertyOrThrow(user, propertyId);
    const plans = await this.prisma.foodPlan.findMany({
      where: { propertyId },
      orderBy: { createdAt: 'desc' },
    });
    return plans.map(FoodPlanResponseDto.fromEntity);
  }

  // Tenant-dashboard listing - `propertyId` is always derived from the
  // caller's own residency, never accepted as a parameter here, and only
  // ACTIVE plans are shown (spec: "only ACTIVE plans can be newly
  // subscribed to").
  async findActiveForProperty(
    propertyId: string,
  ): Promise<FoodPlanResponseDto[]> {
    const plans = await this.prisma.foodPlan.findMany({
      where: { propertyId, status: 'ACTIVE' },
      orderBy: { createdAt: 'desc' },
    });
    return plans.map(FoodPlanResponseDto.fromEntity);
  }

  async findOne(
    user: AuthenticatedUser,
    planId: string,
  ): Promise<FoodPlanResponseDto> {
    const plan = await this.getAccessiblePlanOrThrow(user, planId);
    return FoodPlanResponseDto.fromEntity(plan);
  }

  async update(
    user: AuthenticatedUser,
    planId: string,
    dto: UpdateFoodPlanDto,
  ): Promise<FoodPlanResponseDto> {
    const plan = await this.getAccessiblePlanOrThrow(user, planId);
    await this.assertManageRole(user, plan.organizationId);

    const updated = await this.prisma.foodPlan.update({
      where: { id: plan.id },
      data: {
        name: dto.name,
        description: dto.description,
        mealTypes: dto.mealTypes,
      },
    });
    this.logger.log(`FOOD_PLAN_UPDATED plan=${plan.id} by=${user.id}`);
    const changedFields = (
      Object.keys(dto) as (keyof UpdateFoodPlanDto)[]
    ).filter((key) => dto[key] !== undefined);
    await this.auditLog.record({
      actorUserId: user.id,
      action: 'FOOD_PLAN_UPDATED',
      entityType: 'FoodPlan',
      entityId: plan.id,
      organizationId: plan.organizationId,
      metadata: { propertyId: plan.propertyId, changedFields },
    });
    return FoodPlanResponseDto.fromEntity(updated);
  }

  async archive(
    user: AuthenticatedUser,
    planId: string,
  ): Promise<FoodPlanResponseDto> {
    const plan = await this.getAccessiblePlanOrThrow(user, planId);
    await this.assertManageRole(user, plan.organizationId);

    if (plan.status === 'ARCHIVED') {
      throw new AppException(
        ErrorCode.INVALID_PLATFORM_OPERATION,
        'This food plan is already archived.',
        HttpStatus.CONFLICT,
      );
    }
    const archived = await this.prisma.foodPlan.update({
      where: { id: plan.id },
      data: { status: 'ARCHIVED' },
    });
    this.logger.log(`FOOD_PLAN_ARCHIVED plan=${plan.id} by=${user.id}`);
    await this.auditLog.record({
      actorUserId: user.id,
      action: 'FOOD_PLAN_ARCHIVED',
      entityType: 'FoodPlan',
      entityId: plan.id,
      organizationId: plan.organizationId,
      metadata: { propertyId: plan.propertyId, name: plan.name },
    });
    return FoodPlanResponseDto.fromEntity(archived);
  }

  // Reused by FoodSubscriptionsService (subscribing requires an ACTIVE
  // plan at the tenant's own property) and by the admin controller - a
  // single BOLA-safe lookup, never re-derived.
  async getAccessiblePlanOrThrow(
    user: AuthenticatedUser,
    planId: string,
  ): Promise<FoodPlan> {
    const isSuperAdmin = user.platformRole === 'SUPER_ADMIN';
    const plan = await this.prisma.foodPlan.findFirst({
      where: {
        id: planId,
        organizationId: isSuperAdmin
          ? undefined
          : { in: await this.memberships.listActiveOrganizationIds(user.id) },
      },
    });
    if (!plan) {
      throw this.notFound();
    }
    return plan;
  }

  private async assertManageRole(
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
    this.memberships.assertRole(user, membership, MANAGE_ROLES);
  }

  private notFound(): AppException {
    return new AppException(
      ErrorCode.FOOD_PLAN_NOT_FOUND,
      'Food plan not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}
