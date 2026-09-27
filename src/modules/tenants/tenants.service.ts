import { HttpStatus, Injectable } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { TenantResponseDto } from './dto/tenant-response.dto';
import { TenantLookupResponseDto } from './dto/tenant-lookup-response.dto';
import { idPrefixFromTenantCode, tenantCodeFromId } from './tenant-code';

const LOOKUP_ROLES = ['OWNER', 'MANAGER'] as const;

// Deliberately minimal: Phase 4's spec explicitly says "if Tenant requires
// HTTP APIs, keep them minimal" and warns against adding fields/endpoints
// "just because they might be useful later." With Tenant reduced to
// {id, userId, createdAt} (see schema.prisma), there is nothing for a
// PATCH endpoint to usefully change and no business justification yet for
// a platform-wide "list all tenants" endpoint (Tenant carries no PII of
// its own, but a bare list would still be a pointless capability with no
// caller who needs it in Phase 4). Only two endpoints are implemented:
// self-service creation, and a single accessible-scoped read - both
// documented in README's "Phase 4" section as a deliberate reduction from
// the spec's full suggested list.
@Injectable()
export class TenantsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
  ) {}

  // userId is always the authenticated caller, never client-supplied -
  // there is no "create a tenant profile for someone else" operation in
  // Phase 4 (that would need its own authorization story this phase
  // doesn't define). A second attempt raises Prisma's P2002 on the unique
  // `userId` column, already mapped to 409 CONFLICT by AllExceptionsFilter.
  async createForSelf(user: AuthenticatedUser): Promise<TenantResponseDto> {
    const tenant = await this.prisma.tenant.create({
      data: { userId: user.id },
    });
    return TenantResponseDto.fromEntity(tenant);
  }

  // Visible to: the tenant's own user, a SUPER_ADMIN, or any active member
  // of an organization where this tenant has at least one Residency (the
  // operational reason an OWNER/MANAGER/STAFF would ever need to look up a
  // tenantId - e.g. to confirm one before creating a new residency for a
  // returning resident). Anyone else gets the same 404 a nonexistent
  // tenant would - existence is never confirmed to an unrelated caller.
  async findOne(
    user: AuthenticatedUser,
    tenantId: string,
  ): Promise<TenantResponseDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw this.notFound();
    }
    if (user.platformRole === 'SUPER_ADMIN' || tenant.userId === user.id) {
      return TenantResponseDto.fromEntity(tenant);
    }

    const organizationIds = await this.memberships.listActiveOrganizationIds(
      user.id,
    );
    if (organizationIds.length > 0) {
      const sharedResidency = await this.prisma.residency.findFirst({
        where: {
          tenantId,
          property: { organizationId: { in: organizationIds } },
        },
      });
      if (sharedResidency) {
        return TenantResponseDto.fromEntity(tenant);
      }
    }

    throw this.notFound();
  }

  // The caller's own tenant profile (GET /me/tenant) - how a tenant finds
  // the code to give a property team at check-in. 404 when they have none
  // yet (created by POST /tenants, or by an owner's start-onboarding).
  async findMine(user: AuthenticatedUser): Promise<TenantResponseDto> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { userId: user.id },
    });
    if (!tenant) {
      throw this.notFound();
    }
    return TenantResponseDto.fromEntity(tenant);
  }

  // Resolves a tenant code (TN-XXXX-XXXX) for an OWNER/MANAGER about to
  // check someone in - the same people who may already create a residency
  // for any existing tenantId (see assertExists below), so this grants no
  // new capability, it only swaps an unreadable UUID for a short code.
  // Anyone without an OWNER/MANAGER membership gets the same 404 as an
  // unknown code, so the endpoint can't be used to probe codes.
  async lookupByCode(
    user: AuthenticatedUser,
    code: string,
  ): Promise<TenantLookupResponseDto> {
    if (user.platformRole !== 'SUPER_ADMIN') {
      const membership = await this.prisma.organizationMembership.findFirst({
        where: {
          userId: user.id,
          status: 'ACTIVE',
          role: { in: [...LOOKUP_ROLES] },
        },
        select: { id: true },
      });
      if (!membership) {
        throw this.notFound();
      }
    }

    const prefix = idPrefixFromTenantCode(code);
    if (!prefix) {
      throw new AppException(
        ErrorCode.VALIDATION_FAILED,
        'Enter a tenant code like TN-3K7Q-9XZ2.',
        HttpStatus.BAD_REQUEST,
      );
    }
    const matches = await this.prisma.tenant.findMany({
      where: { id: { startsWith: prefix } },
      select: { id: true, user: { select: { name: true } } },
      take: 2,
    });
    if (matches.length === 0) {
      throw this.notFound();
    }
    if (matches.length > 1) {
      throw new AppException(
        ErrorCode.TENANT_CODE_AMBIGUOUS,
        'This code matches more than one tenant. Use the full tenant ID instead.',
        HttpStatus.CONFLICT,
      );
    }
    const [tenant] = matches;
    const dto = new TenantLookupResponseDto();
    dto.tenantId = tenant.id;
    dto.code = tenantCodeFromId(tenant.id);
    dto.name = tenant.user.name;
    return dto;
  }

  // Internal reuse seam for ResidenciesService.create - "does this tenant
  // exist at all" is a plain existence check, not an access-scoped one
  // (unlike findOne above): creating a residency for a tenant an
  // OWNER/MANAGER has never dealt with before is the normal first
  // interaction, not a cross-tenant access violation.
  async assertExists(tenantId: string): Promise<Tenant> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { id: tenantId },
    });
    if (!tenant) {
      throw this.notFound();
    }
    return tenant;
  }

  private notFound(): AppException {
    return new AppException(
      ErrorCode.TENANT_NOT_FOUND,
      'Tenant not found.',
      HttpStatus.NOT_FOUND,
    );
  }
}
