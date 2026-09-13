import { Injectable, Logger } from '@nestjs/common';
import { Organization, OrganizationMembership } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { OrganizationResponseDto } from './dto/organization-response.dto';

@Injectable()
export class OrganizationsService {
  private readonly logger = new Logger(OrganizationsService.name);

  constructor(private readonly prisma: PrismaService) {}

  // Organization + its OWNER membership are created in one transaction -
  // an organization must never exist without an owner (section 8's
  // explicit requirement), so if the membership insert fails for any
  // reason (e.g. a future uniqueness constraint), the organization insert
  // rolls back with it rather than leaving an orphaned, ownerless
  // organization behind.
  async create(
    user: AuthenticatedUser,
    dto: CreateOrganizationDto,
  ): Promise<OrganizationResponseDto> {
    const organization = await this.prisma.$transaction(async (tx) => {
      const org = await tx.organization.create({ data: { name: dto.name } });
      await tx.organizationMembership.create({
        data: {
          userId: user.id,
          organizationId: org.id,
          role: 'OWNER',
          status: 'ACTIVE',
        },
      });
      return org;
    });

    this.logger.log(
      `ORGANIZATION_CREATED org=${organization.id} owner=${user.id}`,
    );
    return OrganizationResponseDto.fromEntity(organization, 'OWNER');
  }

  // SUPER_ADMIN sees every organization (platform-level access); anyone
  // else sees only organizations where they hold an ACTIVE membership -
  // never a raw `findMany()` a caller could accidentally run unscoped.
  async findAccessible(
    user: AuthenticatedUser,
  ): Promise<OrganizationResponseDto[]> {
    if (user.platformRole === 'SUPER_ADMIN') {
      const organizations = await this.prisma.organization.findMany({
        orderBy: { createdAt: 'desc' },
      });
      return organizations.map((org) =>
        OrganizationResponseDto.fromEntity(org),
      );
    }

    const memberships = await this.prisma.organizationMembership.findMany({
      where: { userId: user.id, status: 'ACTIVE' },
      include: { organization: true },
      orderBy: { createdAt: 'desc' },
    });
    return memberships.map((membership) =>
      OrganizationResponseDto.fromEntity(
        membership.organization,
        membership.role,
      ),
    );
  }

  // Access to this specific organization has already been verified by
  // OrganizationMembershipGuard by the time a controller calls this - this
  // method only shapes the response, it does not re-check authorization.
  toResponse(
    organization: Organization,
    membership: OrganizationMembership | null,
  ): OrganizationResponseDto {
    return OrganizationResponseDto.fromEntity(
      organization,
      membership?.role ?? null,
    );
  }

  async update(
    organizationId: string,
    dto: UpdateOrganizationDto,
    membership: OrganizationMembership | null,
  ): Promise<OrganizationResponseDto> {
    const organization = await this.prisma.organization.update({
      where: { id: organizationId },
      data: { name: dto.name },
    });
    return OrganizationResponseDto.fromEntity(
      organization,
      membership?.role ?? null,
    );
  }
}
