import { HttpStatus, Injectable } from '@nestjs/common';
import { Tenant } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AppException } from '../../common/exceptions/app.exception';
import { ErrorCode } from '../../common/constants/error-code.enum';
import { MembershipsService } from '../memberships/memberships.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { TenantResponseDto } from './dto/tenant-response.dto';

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
