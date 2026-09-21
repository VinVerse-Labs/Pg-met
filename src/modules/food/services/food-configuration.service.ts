import { Injectable, Logger } from '@nestjs/common';
import { FoodConfiguration, MembershipRole } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { MembershipsService } from '../../memberships/memberships.service';
import { PropertiesService } from '../../properties/properties.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { UpdateFoodConfigurationDto } from '../dto/update-food-configuration.dto';
import { FoodConfigurationResponseDto } from '../dto/food-configuration-response.dto';

const CONFIGURE_ROLES: MembershipRole[] = ['OWNER', 'MANAGER'];

// One row per property (spec section 9-10). Lazily provisioned - there is
// no separate "create configuration" endpoint, mirroring Phase 7's
// ensureSubscriptionExists: the first GET or PATCH for a property that
// has never configured food gets a disabled-by-default row.
@Injectable()
export class FoodConfigurationService {
  private readonly logger = new Logger(FoodConfigurationService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly properties: PropertiesService,
    private readonly auditLog: AuditLogService,
  ) {}

  async findForProperty(
    user: AuthenticatedUser,
    propertyId: string,
  ): Promise<FoodConfigurationResponseDto> {
    const property = await this.properties.getAccessiblePropertyOrThrow(
      user,
      propertyId,
    );
    const config = await this.getOrCreate(property.organizationId, propertyId);
    return FoodConfigurationResponseDto.fromEntity(config);
  }

  async update(
    user: AuthenticatedUser,
    propertyId: string,
    dto: UpdateFoodConfigurationDto,
  ): Promise<FoodConfigurationResponseDto> {
    const property = await this.properties.getAccessiblePropertyOrThrow(
      user,
      propertyId,
    );
    await this.assertConfigureRole(user, property.organizationId);

    const existing = await this.getOrCreate(
      property.organizationId,
      propertyId,
    );
    const updated = await this.prisma.foodConfiguration.update({
      where: { id: existing.id },
      data: {
        enabled: dto.enabled,
        mealsIncludedInRent: dto.mealsIncludedInRent,
        includedMealTypes: dto.includedMealTypes,
        optionalSubscriptionEnabled: dto.optionalSubscriptionEnabled,
      },
    });
    this.logger.log(
      `FOOD_CONFIGURATION_UPDATED property=${propertyId} by=${user.id}`,
    );
    // Written only after the mutation above has already succeeded -
    // never inside a try/catch that could still fail after this point,
    // and never reachable from assertConfigureRole's throw path (an
    // unauthorized/cross-organization attempt never gets here at all).
    // Same "audit right after the successful write, in the service that
    // owns it" placement as PlatformAdminService.suspendOrganization
    // (Phase 8).
    const changedFields = (
      Object.keys(dto) as (keyof UpdateFoodConfigurationDto)[]
    ).filter((key) => dto[key] !== undefined);
    await this.auditLog.record({
      actorUserId: user.id,
      action: 'FOOD_CONFIGURATION_UPDATED',
      entityType: 'FoodConfiguration',
      entityId: updated.id,
      organizationId: property.organizationId,
      metadata: { propertyId, changedFields },
    });
    return FoodConfigurationResponseDto.fromEntity(updated);
  }

  // Internal reuse seam - FoodEntitlementService/FoodPlansService/
  // FoodSubscriptionsService all need the raw configuration row, not the
  // response DTO shape, and none of them should re-derive the lazy-create
  // logic themselves.
  async getOrCreate(
    organizationId: string,
    propertyId: string,
  ): Promise<FoodConfiguration> {
    const existing = await this.prisma.foodConfiguration.findUnique({
      where: { propertyId },
    });
    if (existing) {
      return existing;
    }
    try {
      return await this.prisma.foodConfiguration.create({
        data: { organizationId, propertyId },
      });
    } catch (error) {
      // Two concurrent first-access requests for the same property can
      // both pass the pre-check above - propertyId is @unique, so only
      // one INSERT wins; the loser re-reads the winner's row rather than
      // erroring, the same pattern SubscriptionsService.ensureSubscriptionExists
      // already uses.
      const existingAfterRace = await this.prisma.foodConfiguration.findUnique({
        where: { propertyId },
      });
      if (existingAfterRace) {
        return existingAfterRace;
      }
      throw error;
    }
  }

  private async assertConfigureRole(
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
    this.memberships.assertRole(user, membership, CONFIGURE_ROLES);
  }
}
