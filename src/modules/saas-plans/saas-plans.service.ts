import { HttpStatus, Injectable } from '@nestjs/common';
import { Prisma, SaasPlan } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { SaasPlanResponseDto } from './dto/saas-plan-response.dto';
import { CreateSaasPlanDto } from './dto/create-saas-plan.dto';
import { UpdateSaasPlanDto } from './dto/update-saas-plan.dto';

// Phase 7 kept this deliberately minimal (read-only: no admin
// create/update/delete). Phase 8 adds the admin-only mutation methods
// below (adminCreate/adminUpdate/adminDeactivate) - `findActive`/
// `getDefaultActivePlan`/`getActiveByIdOrThrow` are unchanged from Phase
// 7 and remain the only methods a non-admin caller's code path reaches.
@Injectable()
export class SaasPlansService {
  constructor(private readonly prisma: PrismaService) {}

  // Only ACTIVE plans are ever shown to a normal client (spec: "only
  // return active plans to normal clients") - an INACTIVE plan still
  // exists for historical subscriptions/invoices that reference it, but
  // is never offered for a new subscription/plan-change.
  async findActive(): Promise<SaasPlanResponseDto[]> {
    const plans = await this.prisma.saasPlan.findMany({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    return plans.map(SaasPlanResponseDto.fromEntity);
  }

  // The plan a brand-new subscription starts on, and the same one
  // change-plan validates against - the oldest ACTIVE plan is the
  // platform's current default (documented assumption; there is no
  // separate "default" flag in Phase 7's minimal model).
  async getDefaultActivePlan(): Promise<SaasPlan> {
    const plan = await this.prisma.saasPlan.findFirst({
      where: { status: 'ACTIVE' },
      orderBy: { createdAt: 'asc' },
    });
    if (!plan) {
      throw new AppException(
        ErrorCode.SAAS_PLAN_NOT_FOUND,
        'No active SaaS plan is configured.',
        HttpStatus.NOT_FOUND,
      );
    }
    return plan;
  }

  async getActiveByIdOrThrow(planId: string): Promise<SaasPlan> {
    const plan = await this.prisma.saasPlan.findFirst({
      where: { id: planId, status: 'ACTIVE' },
    });
    if (!plan) {
      throw new AppException(
        ErrorCode.SAAS_PLAN_NOT_FOUND,
        'SaaS plan not found or no longer active.',
        HttpStatus.NOT_FOUND,
      );
    }
    return plan;
  }

  // --- Platform admin (Phase 8) ---

  async adminFindAll(): Promise<SaasPlanResponseDto[]> {
    const plans = await this.prisma.saasPlan.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return plans.map(SaasPlanResponseDto.fromEntity);
  }

  async adminFindOneOrThrow(planId: string): Promise<SaasPlanResponseDto> {
    const plan = await this.prisma.saasPlan.findUnique({
      where: { id: planId },
    });
    if (!plan) {
      throw new AppException(
        ErrorCode.SAAS_PLAN_NOT_FOUND,
        'SaaS plan not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return SaasPlanResponseDto.fromEntity(plan);
  }

  // A brand-new row every time (spec: "if the price changes... use
  // versioning/effective dates or create a new plan version") - never an
  // in-place price edit. `price` is set exactly once, at creation, and
  // `adminUpdate` below cannot touch it.
  async adminCreate(dto: CreateSaasPlanDto): Promise<SaasPlanResponseDto> {
    const plan = await this.prisma.saasPlan.create({
      data: {
        name: dto.name,
        description: dto.description,
        price: new Prisma.Decimal(dto.price),
        currency: dto.currency ?? 'INR',
      },
    });
    return SaasPlanResponseDto.fromEntity(plan);
  }

  // Deliberately cannot touch `price`/`currency` - `UpdateSaasPlanDto`
  // has no field for either, so there is no way for this method to ever
  // be asked to mutate a value a historical `SubscriptionInvoice` has
  // already snapshotted (spec: "historical pricing MUST remain
  // immutable"). Only cosmetic fields (`name`/`description`) are mutable
  // in place.
  async adminUpdate(
    planId: string,
    dto: UpdateSaasPlanDto,
  ): Promise<SaasPlanResponseDto> {
    await this.adminFindOneOrThrow(planId);
    const plan = await this.prisma.saasPlan.update({
      where: { id: planId },
      data: { name: dto.name, description: dto.description },
    });
    return SaasPlanResponseDto.fromEntity(plan);
  }

  async adminDeactivate(planId: string): Promise<SaasPlanResponseDto> {
    const existing = await this.prisma.saasPlan.findUnique({
      where: { id: planId },
    });
    if (!existing) {
      throw new AppException(
        ErrorCode.SAAS_PLAN_NOT_FOUND,
        'SaaS plan not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    if (existing.status === 'INACTIVE') {
      throw new AppException(
        ErrorCode.SAAS_PLAN_ALREADY_INACTIVE,
        'This plan is already inactive.',
        HttpStatus.CONFLICT,
      );
    }
    const plan = await this.prisma.saasPlan.update({
      where: { id: planId },
      data: { status: 'INACTIVE', effectiveTo: new Date() },
    });
    return SaasPlanResponseDto.fromEntity(plan);
  }
}
