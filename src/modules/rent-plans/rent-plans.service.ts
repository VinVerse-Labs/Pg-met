import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { MembershipRole, Prisma, RentPlan } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { ResidenciesService } from '../residencies/residencies.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateRentPlanDto } from './dto/create-rent-plan.dto';
import { UpdateRentPlanDto } from './dto/update-rent-plan.dto';
import { RentPlanResponseDto } from './dto/rent-plan-response.dto';

// Same role split as every prior phase: MANAGER handles day-to-day
// operational work (setting/changing rent), STAFF is read-only.
const CREATE_UPDATE_ROLES: MembershipRole[] = ['OWNER', 'MANAGER'];

type RentPlanWithOrganization = RentPlan & { organizationId: string };

@Injectable()
export class RentPlansService {
  private readonly logger = new Logger(RentPlansService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly residencies: ResidenciesService,
  ) {}

  // Setting or changing a residency's rent. NEVER mutates an existing
  // ACTIVE plan's amount - if one already exists, it is closed out
  // (`effectiveTo` set to the new plan's `effectiveFrom`, `status:
  // INACTIVE`) and a brand new row is inserted, in the same transaction,
  // so historical invoices generated against the old plan remain provably
  // accurate (spec section 8) without this service ever needing to touch
  // them.
  async create(
    user: AuthenticatedUser,
    residencyId: string,
    dto: CreateRentPlanDto,
  ): Promise<RentPlanResponseDto> {
    const residency = await this.residencies.getAccessibleResidencyOrThrow(
      user,
      residencyId,
    );
    await this.assertRole(user, residency.organizationId, CREATE_UPDATE_ROLES);

    const amount = new Prisma.Decimal(dto.amount);
    if (amount.lessThanOrEqualTo(0)) {
      throw new AppException(
        ErrorCode.INVALID_RENT_PLAN,
        'amount must be greater than zero.',
        HttpStatus.BAD_REQUEST,
      );
    }

    const effectiveFrom = new Date(dto.effectiveFrom);
    const currentPlan = await this.prisma.rentPlan.findFirst({
      where: { residencyId, status: 'ACTIVE' },
    });
    if (currentPlan && effectiveFrom <= currentPlan.effectiveFrom) {
      throw new AppException(
        ErrorCode.INVALID_RENT_PLAN,
        "effectiveFrom must be after the current rent plan's effectiveFrom.",
        HttpStatus.BAD_REQUEST,
      );
    }

    try {
      const created = await this.prisma.$transaction(async (tx) => {
        if (currentPlan) {
          await tx.rentPlan.update({
            where: { id: currentPlan.id },
            data: { status: 'INACTIVE', effectiveTo: effectiveFrom },
          });
        }
        return tx.rentPlan.create({
          data: {
            residencyId,
            amount,
            currency: dto.currency ?? 'INR',
            dueDay: dto.dueDay,
            effectiveFrom,
          },
        });
      });

      this.logger.log(
        `RENT_PLAN_CREATED rentPlan=${created.id} residency=${residencyId} by=${user.id}`,
      );
      return RentPlanResponseDto.fromEntity(created);
    } catch (error) {
      // Two concurrent "change the rent" requests for the same residency
      // could both read `currentPlan` before either commits - the partial
      // unique index (rent_plans_active_residency_unique) lets only one
      // new ACTIVE row through; the loser's INSERT raises P2002 here.
      if (this.isUniqueViolation(error, 'rent_plans_active_residency_unique')) {
        throw new AppException(
          ErrorCode.INVALID_RENT_PLAN,
          'A rent plan change for this residency was just made by another request.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }
  }

  async findCurrent(
    user: AuthenticatedUser,
    residencyId: string,
  ): Promise<RentPlanResponseDto> {
    await this.residencies.getAccessibleResidencyOrThrow(user, residencyId);
    const plan = await this.prisma.rentPlan.findFirst({
      where: { residencyId, status: 'ACTIVE' },
    });
    if (!plan) {
      throw new AppException(
        ErrorCode.RENT_PLAN_NOT_FOUND,
        'This residency has no active rent plan.',
        HttpStatus.NOT_FOUND,
      );
    }
    return RentPlanResponseDto.fromEntity(plan);
  }

  async update(
    user: AuthenticatedUser,
    rentPlanId: string,
    dto: UpdateRentPlanDto,
  ): Promise<RentPlanResponseDto> {
    const plan = await this.getAccessibleRentPlanOrThrow(user, rentPlanId);
    await this.assertRole(user, plan.organizationId, CREATE_UPDATE_ROLES);

    if (dto.deactivate) {
      if (plan.status !== 'ACTIVE') {
        throw new AppException(
          ErrorCode.INVALID_RENT_PLAN,
          'Only an ACTIVE rent plan can be deactivated.',
          HttpStatus.CONFLICT,
        );
      }
      const updated = await this.prisma.rentPlan.update({
        where: { id: rentPlanId },
        data: {
          status: 'INACTIVE',
          effectiveTo: plan.effectiveTo ?? new Date(),
        },
      });
      this.logger.log(
        `RENT_PLAN_DEACTIVATED rentPlan=${rentPlanId} by=${user.id}`,
      );
      return RentPlanResponseDto.fromEntity(updated);
    }

    if (dto.dueDay !== undefined) {
      const updated = await this.prisma.rentPlan.update({
        where: { id: rentPlanId },
        data: { dueDay: dto.dueDay },
      });
      return RentPlanResponseDto.fromEntity(updated);
    }

    return RentPlanResponseDto.fromEntity(plan);
  }

  // BOLA/IDOR defense, same single-query pattern as every prior phase,
  // joining two levels up (RentPlan -> Residency -> Property) to reach
  // organizationId.
  private async getAccessibleRentPlanOrThrow(
    user: AuthenticatedUser,
    rentPlanId: string,
  ): Promise<RentPlanWithOrganization> {
    const isSuperAdmin = user.platformRole === 'SUPER_ADMIN';
    const accessibleOrgIds = isSuperAdmin
      ? undefined
      : await this.memberships.listActiveOrganizationIds(user.id);

    const plan = await this.prisma.rentPlan.findFirst({
      where: {
        id: rentPlanId,
        residency: isSuperAdmin
          ? undefined
          : { property: { organizationId: { in: accessibleOrgIds } } },
      },
      include: {
        residency: {
          include: { property: { select: { organizationId: true } } },
        },
      },
    });
    if (!plan) {
      throw new AppException(
        ErrorCode.RENT_PLAN_NOT_FOUND,
        'Rent plan not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    const { residency, ...fields } = plan;
    return { ...fields, organizationId: residency.property.organizationId };
  }

  private async assertRole(
    user: AuthenticatedUser,
    organizationId: string,
    allowedRoles: MembershipRole[],
  ): Promise<void> {
    if (user.platformRole === 'SUPER_ADMIN') {
      return;
    }
    const membership = await this.memberships.getActiveMembership(
      user.id,
      organizationId,
    );
    this.memberships.assertRole(user, membership, allowedRoles);
  }

  private isUniqueViolation(error: unknown, indexName: string): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    const target = error.meta?.target;
    if (typeof target === 'string') {
      return target.includes(indexName);
    }
    if (Array.isArray(target)) {
      return target.includes(indexName);
    }
    return false;
  }
}
