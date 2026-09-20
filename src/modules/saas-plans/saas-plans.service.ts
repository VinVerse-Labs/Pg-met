import { HttpStatus, Injectable } from '@nestjs/common';
import { SaasPlan } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { SaasPlanResponseDto } from './dto/saas-plan-response.dto';

// Deliberately minimal (spec: "administrative plan management can be
// deferred... do NOT build a full platform-admin system in Phase 7") -
// only what's needed for an owner to see what plans exist and for
// SubscriptionsService to resolve a plan by id. No create/update/delete
// endpoint exists; new plans are added by inserting a row directly
// (see SaasPlan's doc comment in schema.prisma) until a real admin
// surface is a requirement.
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
}
