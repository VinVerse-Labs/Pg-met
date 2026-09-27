import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { MyStayResponseDto } from '../dto/my-stay-response.dto';

// Current-stay priority: a stay the tenant is living in right now
// (ACTIVE, or NOTICE_PERIOD - still living there) wins over an upcoming
// PENDING one (created by the owner, not yet checked in). CHECKED_OUT is
// history and never "the current stay".
const CURRENT_STATUSES = ['ACTIVE', 'NOTICE_PERIOD'] as const;

@Injectable()
export class MyStayService {
  constructor(private readonly prisma: PrismaService) {}

  // Always resolved from the authenticated caller (tenant.userId) - there
  // is no residencyId/tenantId input, so a tenant can never switch
  // themselves into someone else's stay. `null` (not 404) when there is no
  // stay: "no stay yet" is a normal state for a tenant account, the same
  // convention as GET /me/food/subscription.
  async findCurrent(
    user: AuthenticatedUser,
  ): Promise<MyStayResponseDto | null> {
    const tenant = await this.prisma.tenant.findUnique({
      where: { userId: user.id },
      select: { id: true },
    });
    if (!tenant) return null;

    const include = {
      property: {
        select: {
          id: true,
          name: true,
          propertyType: true,
          addressLine1: true,
          addressLine2: true,
          city: true,
          state: true,
          postalCode: true,
          timezone: true,
        },
      },
      allocations: {
        where: { status: 'ACTIVE' as const },
        orderBy: { startDate: 'desc' as const },
        take: 1,
        include: {
          bed: {
            select: {
              bedNumber: true,
              berth: true,
              room: {
                select: { roomNumber: true, floor: true, roomType: true },
              },
            },
          },
        },
      },
      rentPlans: {
        where: { status: 'ACTIVE' as const },
        orderBy: { effectiveFrom: 'desc' as const },
        take: 1,
      },
    };

    const residency =
      (await this.prisma.residency.findFirst({
        where: { tenantId: tenant.id, status: { in: [...CURRENT_STATUSES] } },
        orderBy: { startDate: 'desc' },
        include,
      })) ??
      (await this.prisma.residency.findFirst({
        where: { tenantId: tenant.id, status: 'PENDING' },
        orderBy: { startDate: 'asc' },
        include,
      }));
    if (!residency) return null;

    const allocation = residency.allocations[0];
    const rentPlan = residency.rentPlans[0];
    const dto = new MyStayResponseDto();
    dto.residencyId = residency.id;
    dto.status = residency.status;
    dto.startDate = residency.startDate;
    dto.expectedEndDate = residency.expectedEndDate;
    dto.property = residency.property;
    dto.room = allocation
      ? {
          roomNumber: allocation.bed.room.roomNumber,
          floor: allocation.bed.room.floor,
          roomType: allocation.bed.room.roomType,
        }
      : null;
    dto.bed = allocation
      ? {
          bedNumber: allocation.bed.bedNumber,
          berth: allocation.bed.berth,
          since: allocation.startDate,
        }
      : null;
    dto.rent = rentPlan
      ? {
          amount: rentPlan.amount.toFixed(2),
          currency: rentPlan.currency,
          billingCycle: rentPlan.billingCycle,
          dueDay: rentPlan.dueDay,
        }
      : null;
    return dto;
  }
}
