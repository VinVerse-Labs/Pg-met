import { Injectable } from '@nestjs/common';
import { MembershipRole } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';

// Reusable recipient resolvers (spec section 85) - every event handler in
// NotificationEventService calls into these rather than re-deriving
// "who should know about this" logic inline. Every method resolves purely
// from server-side relationships (Residency/OrganizationMembership), the
// same BOLA-safe posture every prior phase's own authorization chain
// uses - never a client-supplied user id.
@Injectable()
export class NotificationRecipientsService {
  constructor(private readonly prisma: PrismaService) {}

  // Tenant recipient resolution (spec section 44):
  // Residency -> Tenant -> Tenant.userId. Returns null for a residency
  // that (for whatever reason) has no linked tenant user - callers treat
  // that as "nothing to notify," never an error.
  async tenantUserIdForResidency(residencyId: string): Promise<string | null> {
    const residency = await this.prisma.residency.findUnique({
      where: { id: residencyId },
      include: { tenant: { select: { userId: true } } },
    });
    return residency?.tenant.userId ?? null;
  }

  // Every currently-resident tenant at a property (spec section 37/67:
  // "only tenants belonging to that property should receive the
  // notification... do not notify tenants from another property") -
  // ACTIVE or NOTICE_PERIOD residencies only, the same "current resident"
  // definition ComplaintsService/FoodEntitlementService already use.
  async activeTenantUserIdsForProperty(propertyId: string): Promise<string[]> {
    const residencies = await this.prisma.residency.findMany({
      where: { propertyId, status: { in: ['ACTIVE', 'NOTICE_PERIOD'] } },
      include: { tenant: { select: { userId: true } } },
    });
    return [...new Set(residencies.map((r) => r.tenant.userId))];
  }

  // Active organization members holding one of the given roles (spec
  // section 42: "only active memberships should receive operational
  // notifications... do not send manager notifications to another
  // organization").
  async activeOrgMembersByRole(
    organizationId: string,
    roles: MembershipRole[],
  ): Promise<string[]> {
    const memberships = await this.prisma.organizationMembership.findMany({
      where: { organizationId, status: 'ACTIVE', role: { in: roles } },
      select: { userId: true },
    });
    return [...new Set(memberships.map((m) => m.userId))];
  }
}
