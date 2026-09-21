import { randomUUID } from 'crypto';
import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { Prisma } from '@prisma/client';
import { ThrottlerGuard } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/prisma.service';

// Same in-memory FakePrisma pattern as every prior phase's e2e suite,
// extended through Phase 10: food_configurations, food_plans,
// tenant_food_subscriptions, food_subscription_invoices, menus,
// menu_items, meal_consumptions, plus organization_subscriptions/
// saas_plans so FoodSubscriptionsService's SUBSCRIPTION_SUSPENDED gate
// (reusing Phase 9's isOrganizationWriteBlocked wiring) can be exercised
// over real HTTP. Razorpay order/payment creation itself is proven
// against real Postgres instead (see this phase's verification script) -
// faking gateway.createOrder here would just be re-testing the mock, not
// the actual money-movement code path.
class FakePrisma {
  private users = new Map<string, any>();
  private refreshTokens = new Map<string, any>();
  private organizations = new Map<string, any>();
  private memberships = new Map<string, any>();
  private properties = new Map<string, any>();
  private rooms = new Map<string, any>();
  private beds = new Map<string, any>();
  private tenants = new Map<string, any>();
  private residencies = new Map<string, any>();
  private bedAllocations = new Map<string, any>();
  private saasPlans = new Map<string, any>();
  private subscriptions = new Map<string, any>();
  private foodConfigurations = new Map<string, any>();
  private foodPlans = new Map<string, any>();
  private foodSubscriptions = new Map<string, any>();
  private foodSubscriptionInvoices = new Map<string, any>();
  private menus = new Map<string, any>();
  private menuItems = new Map<string, any>();
  private mealConsumptions = new Map<string, any>();
  private auditLogs = new Map<string, any>();

  constructor() {
    const planId = this.nextId();
    this.saasPlans.set(planId, {
      id: planId,
      name: 'Basic',
      description: 'Default plan',
      price: new Prisma.Decimal('499.00'),
      currency: 'INR',
      billingInterval: 'MONTHLY',
      status: 'ACTIVE',
      createdAt: new Date('2026-01-01'),
      updatedAt: new Date('2026-01-01'),
      effectiveTo: null,
    });
  }

  private nextId(): string {
    return randomUUID();
  }

  private conflict(target: string): never {
    throw new Prisma.PrismaClientKnownRequestError('Unique constraint failed', {
      code: 'P2002',
      clientVersion: '5.22.0',
      meta: { target },
    });
  }

  user = {
    findUnique: async ({ where }: any) => {
      if (where.id) return this.users.get(where.id) ?? null;
      if (where.email) {
        return (
          [...this.users.values()].find((u) => u.email === where.email) ?? null
        );
      }
      return null;
    },
    create: async ({ data }: any) => {
      if (
        data.email &&
        [...this.users.values()].some((u) => u.email === data.email)
      ) {
        this.conflict('email');
      }
      const id = this.nextId();
      const now = new Date();
      const user = {
        id,
        platformRole: 'USER',
        status: 'ACTIVE',
        email: null,
        phone: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.users.set(id, user);
      return user;
    },
    update: async ({ where, data }: any) => {
      const user = this.users.get(where.id);
      Object.assign(user, data);
      return user;
    },
  };

  refreshToken = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const row = { id, revokedAt: null, createdAt: new Date(), ...data };
      this.refreshTokens.set(id, row);
      return row;
    },
    findUnique: async ({ where }: any) =>
      [...this.refreshTokens.values()].find(
        (r) => r.tokenHash === where.tokenHash,
      ) ?? null,
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const row of this.refreshTokens.values()) {
        if (Object.entries(where).every(([k, v]) => row[k] === v)) {
          Object.assign(row, data);
          count += 1;
        }
      }
      return { count };
    },
  };

  organization = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const org = {
        id,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.organizations.set(id, org);
      return org;
    },
    findUnique: async ({ where }: any) =>
      this.organizations.get(where.id) ?? null,
    findMany: async () => [...this.organizations.values()],
  };

  organizationMembership = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const membership = {
        id,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.memberships.set(id, membership);
      return membership;
    },
    findFirst: async ({ where }: any) =>
      [...this.memberships.values()].find((m) =>
        Object.entries(where).every(([k, v]) => m[k as keyof typeof m] === v),
      ) ?? null,
    findMany: async ({ where, select }: any) => {
      const rows = [...this.memberships.values()].filter((m) =>
        Object.entries(where ?? {}).every(([k, v]) => m[k] === v),
      );
      if (select?.organizationId) {
        return rows.map((m) => ({ organizationId: m.organizationId }));
      }
      return rows;
    },
  };

  property = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const property = {
        id,
        propertyType: 'PG',
        status: 'ACTIVE',
        addressLine2: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.properties.set(id, property);
      return property;
    },
    findUnique: async ({ where }: any) => this.properties.get(where.id) ?? null,
    findFirst: async ({ where }: any) => {
      const orgFilter = where.organizationId;
      return (
        [...this.properties.values()].find((p) => {
          if (p.id !== where.id) return false;
          if (!orgFilter) return true;
          if (typeof orgFilter === 'string')
            return p.organizationId === orgFilter;
          if (orgFilter.in) return orgFilter.in.includes(p.organizationId);
          return false;
        }) ?? null
      );
    },
  };

  room = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const room = {
        id,
        floor: null,
        status: 'ACTIVE',
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.rooms.set(id, room);
      return room;
    },
    findFirst: async ({ where, include }: any) => {
      const room = [...this.rooms.values()].find(
        (r) =>
          r.id === where.id &&
          (!where.propertyId || r.propertyId === where.propertyId),
      );
      if (!room) return null;
      if (include?.property) {
        return { ...room, property: this.properties.get(room.propertyId) };
      }
      return room;
    },
  };

  bed = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const bed = {
        id,
        status: 'AVAILABLE',
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.beds.set(id, bed);
      return bed;
    },
    count: async ({ where }: any = {}) =>
      [...this.beds.values()].filter((b) => {
        if (b.roomId !== where.roomId) return false;
        if (where.status?.not) return b.status !== where.status.not;
        return true;
      }).length,
    findFirst: async ({ where, include }: any) => {
      const bed = [...this.beds.values()].find((b) => {
        if (b.id !== where.id) return false;
        if (where.roomId && b.roomId !== where.roomId) return false;
        if (where.room?.propertyId) {
          const room = this.rooms.get(b.roomId);
          if (!room || room.propertyId !== where.room.propertyId) return false;
        }
        return true;
      });
      if (!bed) return null;
      if (include?.room) {
        const room = this.rooms.get(bed.roomId);
        const property = include.room.include?.property
          ? this.properties.get(room.propertyId)
          : undefined;
        return { ...bed, room: property ? { ...room, property } : room };
      }
      return bed;
    },
    update: async ({ where, data }: any) => {
      const bed = this.beds.get(where.id);
      Object.assign(bed, data);
      return bed;
    },
  };

  tenant = {
    create: async ({ data }: any) => {
      if ([...this.tenants.values()].some((t) => t.userId === data.userId)) {
        this.conflict('userId');
      }
      const id = this.nextId();
      const now = new Date();
      const tenant = { id, createdAt: now, updatedAt: now, ...data };
      this.tenants.set(id, tenant);
      return tenant;
    },
    findUnique: async ({ where }: any) => {
      if (where.id) return this.tenants.get(where.id) ?? null;
      if (where.userId) {
        return (
          [...this.tenants.values()].find((t) => t.userId === where.userId) ??
          null
        );
      }
      return null;
    },
  };

  residency = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const residency = {
        id,
        status: 'PENDING',
        expectedEndDate: null,
        actualEndDate: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.residencies.set(id, residency);
      return residency;
    },
    findFirst: async ({ where, include }: any) => {
      const residency = [...this.residencies.values()].find((r) => {
        if (where.id && r.id !== where.id) return false;
        if (where.tenantId && r.tenantId !== where.tenantId) return false;
        if (where.propertyId && r.propertyId !== where.propertyId) return false;
        if (where.status?.in && !where.status.in.includes(r.status))
          return false;
        return true;
      });
      if (!residency) return null;
      if (include?.property) {
        return {
          ...residency,
          property: this.properties.get(residency.propertyId),
        };
      }
      return residency;
    },
    update: async ({ where, data }: any) => {
      const residency = this.residencies.get(where.id);
      if (data.status === 'ACTIVE') {
        const conflicting = [...this.residencies.values()].some(
          (r) =>
            r.id !== where.id &&
            r.tenantId === residency.tenantId &&
            r.status === 'ACTIVE',
        );
        if (conflicting) this.conflict('residencies_active_tenant_unique');
      }
      Object.assign(residency, data);
      return residency;
    },
  };

  bedAllocation = {
    create: async ({ data }: any) => {
      const status = data.status ?? 'ACTIVE';
      if (status === 'ACTIVE') {
        const conflicting = [...this.bedAllocations.values()].some(
          (a) => a.bedId === data.bedId && a.status === 'ACTIVE',
        );
        if (conflicting) this.conflict('bed_allocations_active_bed_unique');
      }
      const id = this.nextId();
      const now = new Date();
      const allocation = {
        id,
        status,
        endDate: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.bedAllocations.set(id, allocation);
      return allocation;
    },
    findFirst: async ({ where, include }: any) => {
      const allocation = [...this.bedAllocations.values()].find((a) =>
        Object.entries(where).every(([k, v]) => a[k] === v),
      );
      if (!allocation) return null;
      if (include?.bed)
        return { ...allocation, bed: this.beds.get(allocation.bedId) };
      return allocation;
    },
    update: async ({ where, data }: any) => {
      const allocation = this.bedAllocations.get(where.id);
      Object.assign(allocation, data);
      return allocation;
    },
  };

  saasPlan = {
    findFirst: async ({ where }: any) =>
      [...this.saasPlans.values()].filter(
        (p) => !where?.status || p.status === where.status,
      )[0] ?? null,
    findUnique: async ({ where }: any) => this.saasPlans.get(where.id) ?? null,
  };

  organizationSubscription = {
    findUnique: async ({ where }: any) =>
      [...this.subscriptions.values()].find(
        (s) => s.organizationId === where.organizationId,
      ) ?? null,
    findUniqueOrThrow: async ({ where }: any) => {
      const sub = this.subscriptions.get(where.id);
      if (!sub) throw new Error('subscription not found');
      return { ...sub, saasPlan: this.saasPlans.get(sub.saasPlanId) };
    },
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const sub = {
        id,
        cancelledAt: null,
        pendingSaasPlanId: null,
        gracePeriodEndsAt: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.subscriptions.set(id, sub);
      return sub;
    },
    update: async ({ where, data }: any) => {
      const sub = this.subscriptions.get(where.id);
      Object.assign(sub, data);
      return { ...sub, saasPlan: this.saasPlans.get(sub.saasPlanId) };
    },
  };

  foodConfiguration = {
    findUnique: async ({ where }: any) =>
      [...this.foodConfigurations.values()].find(
        (c) => c.propertyId === where.propertyId,
      ) ?? null,
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const config = {
        id,
        enabled: false,
        mealsIncludedInRent: false,
        includedMealTypes: [],
        optionalSubscriptionEnabled: false,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.foodConfigurations.set(id, config);
      return config;
    },
    update: async ({ where, data }: any) => {
      const config = this.foodConfigurations.get(where.id);
      Object.assign(config, data);
      return config;
    },
  };

  foodPlan = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const plan = {
        id,
        status: 'ACTIVE',
        description: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.foodPlans.set(id, plan);
      return plan;
    },
    findMany: async ({ where }: any) =>
      [...this.foodPlans.values()].filter((p) => {
        if (where?.propertyId && p.propertyId !== where.propertyId)
          return false;
        if (where?.status && p.status !== where.status) return false;
        return true;
      }),
    findFirst: async ({ where }: any) =>
      [...this.foodPlans.values()].find((p) => {
        if (where.id && p.id !== where.id) return false;
        if (where.propertyId && p.propertyId !== where.propertyId) return false;
        if (
          where.organizationId?.in &&
          !where.organizationId.in.includes(p.organizationId)
        )
          return false;
        return true;
      }) ?? null,
    update: async ({ where, data }: any) => {
      const plan = this.foodPlans.get(where.id);
      Object.assign(plan, data);
      return plan;
    },
    count: async ({ where }: any = {}) =>
      [...this.foodPlans.values()].filter(
        (p) => !where?.status || p.status === where.status,
      ).length,
  };

  tenantFoodSubscription = {
    findUnique: async ({ where }: any) =>
      this.foodSubscriptions.get(where.id) ?? null,
    create: async ({ data }: any) => {
      if (
        (data.status ?? 'ACTIVE') === 'ACTIVE' &&
        [...this.foodSubscriptions.values()].some(
          (s) => s.residencyId === data.residencyId && s.status === 'ACTIVE',
        )
      ) {
        this.conflict('food_subscriptions_active_residency_unique');
      }
      const id = this.nextId();
      const now = new Date();
      const sub = {
        id,
        status: 'ACTIVE',
        endDate: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.foodSubscriptions.set(id, sub);
      return sub;
    },
    findFirst: async ({ where, include }: any) => {
      const sub = [...this.foodSubscriptions.values()].find((s) => {
        if (where.id && s.id !== where.id) return false;
        if (where.residencyId && s.residencyId !== where.residencyId)
          return false;
        if (where.status) {
          if (typeof where.status === 'string' && s.status !== where.status)
            return false;
          if (where.status.in && !where.status.in.includes(s.status))
            return false;
        }
        return true;
      });
      if (!sub) return null;
      if (include?.tenant) {
        const tenant = this.tenants.get(sub.tenantId);
        return { ...sub, tenant: { userId: tenant?.userId } };
      }
      return sub;
    },
    findMany: async ({ where }: any) =>
      [...this.foodSubscriptions.values()].filter(
        (s) => !where?.propertyId || s.propertyId === where.propertyId,
      ),
    findUniqueOrThrow: async ({ where }: any) => {
      const sub = this.foodSubscriptions.get(where.id);
      if (!sub) throw new Error('not found');
      return sub;
    },
    updateMany: async ({ where, data }: any) => {
      let count = 0;
      for (const sub of this.foodSubscriptions.values()) {
        if (where.id && sub.id !== where.id) continue;
        if (where.residencyId && sub.residencyId !== where.residencyId)
          continue;
        if (where.status) {
          if (typeof where.status === 'string' && sub.status !== where.status)
            continue;
          if (where.status.in && !where.status.in.includes(sub.status))
            continue;
        }
        Object.assign(sub, data);
        count += 1;
      }
      return { count };
    },
    count: async ({ where }: any = {}) =>
      [...this.foodSubscriptions.values()].filter(
        (s) => !where?.status || s.status === where.status,
      ).length,
  };

  foodSubscriptionInvoice = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const invoice = {
        id,
        invoiceNumber: `FOOD-TEST-${this.foodSubscriptionInvoices.size + 1}`,
        status: 'ISSUED',
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.foodSubscriptionInvoices.set(id, invoice);
      return invoice;
    },
    findFirst: async ({ where, orderBy }: any) => {
      let rows = [...this.foodSubscriptionInvoices.values()].filter(
        (i) =>
          !where?.foodSubscriptionId ||
          i.foodSubscriptionId === where.foodSubscriptionId,
      );
      if (orderBy?.billingPeriodEnd === 'desc') {
        rows = rows.sort((a, b) => b.billingPeriodEnd - a.billingPeriodEnd);
      }
      return rows[0] ?? null;
    },
    findMany: async ({ where }: any) =>
      [...this.foodSubscriptionInvoices.values()].filter(
        (i) => !where?.tenantId || i.tenantId === where.tenantId,
      ),
    count: async ({ where }: any = {}) =>
      [...this.foodSubscriptionInvoices.values()].filter((i) => {
        if (!where?.status) return true;
        if (where.status.in) return where.status.in.includes(i.status);
        return i.status === where.status;
      }).length,
  };

  menu = {
    create: async ({ data, include }: any) => {
      const { items: nestedItems, ...menuData } = data;
      const dateKey = new Date(menuData.date).toISOString();
      const conflict = [...this.menus.values()].some(
        (m) =>
          m.propertyId === menuData.propertyId &&
          new Date(m.date).toISOString() === dateKey,
      );
      if (conflict) this.conflict('propertyId,date');
      const id = this.nextId();
      const now = new Date();
      const menu = {
        id,
        status: 'DRAFT',
        publishedAt: null,
        cancelledAt: null,
        createdAt: now,
        updatedAt: now,
        ...menuData,
      };
      this.menus.set(id, menu);
      if (nestedItems?.create) {
        for (const entry of nestedItems.create) {
          const itemId = this.nextId();
          this.menuItems.set(itemId, {
            id: itemId,
            menuId: id,
            isVegetarian: true,
            isAvailable: true,
            description: null,
            createdAt: now,
            updatedAt: now,
            ...entry,
          });
        }
      }
      if (include?.items) {
        return {
          ...menu,
          items: [...this.menuItems.values()].filter((i) => i.menuId === id),
        };
      }
      return menu;
    },
    findUnique: async ({ where, include }: any) => {
      let menu: any = null;
      if (where.propertyId_date) {
        const { propertyId, date } = where.propertyId_date;
        const dateKey = new Date(date).toISOString();
        menu =
          [...this.menus.values()].find(
            (m) =>
              m.propertyId === propertyId &&
              new Date(m.date).toISOString() === dateKey,
          ) ?? null;
      } else {
        menu = this.menus.get(where.id) ?? null;
      }
      if (!menu) return null;
      if (include?.items) {
        return {
          ...menu,
          items: [...this.menuItems.values()].filter(
            (i) => i.menuId === menu.id,
          ),
        };
      }
      return menu;
    },
    findFirst: async ({ where, include }: any) => {
      const menu = [...this.menus.values()].find((m) => {
        if (where.id && m.id !== where.id) return false;
        if (where.propertyId && m.propertyId !== where.propertyId) return false;
        if (
          where.organizationId?.in &&
          !where.organizationId.in.includes(m.organizationId)
        )
          return false;
        return true;
      });
      if (!menu) return null;
      if (include?.items) {
        const items = [...this.menuItems.values()].filter(
          (i) => i.menuId === menu.id,
        );
        if (include.items.where?.mealType) {
          return {
            ...menu,
            items: items.filter(
              (i) => i.mealType === include.items.where.mealType,
            ),
          };
        }
        return { ...menu, items };
      }
      return menu;
    },
    findMany: async ({ where, include }: any) => {
      const rows = [...this.menus.values()].filter((m) => {
        if (where?.propertyId && m.propertyId !== where.propertyId)
          return false;
        if (where?.status && m.status !== where.status) return false;
        if (where?.date?.gte && new Date(m.date) < new Date(where.date.gte))
          return false;
        if (where?.date?.lte && new Date(m.date) > new Date(where.date.lte))
          return false;
        return true;
      });
      if (include?.items) {
        return rows.map((m) => ({
          ...m,
          items: [...this.menuItems.values()].filter((i) => i.menuId === m.id),
        }));
      }
      return rows;
    },
    findUniqueOrThrow: async ({ where, include }: any) => {
      const menu = this.menus.get(where.id);
      if (!menu) throw new Error('menu not found');
      if (include?.items) {
        return {
          ...menu,
          items: [...this.menuItems.values()].filter(
            (i) => i.menuId === menu.id,
          ),
        };
      }
      return menu;
    },
    updateMany: async ({ where, data }: any) => {
      const menu = this.menus.get(where.id);
      if (!menu) return { count: 0 };
      if (where.status) {
        if (typeof where.status === 'string' && menu.status !== where.status)
          return { count: 0 };
        if (where.status.not && menu.status === where.status.not)
          return { count: 0 };
      }
      Object.assign(menu, data);
      return { count: 1 };
    },
    count: async ({ where }: any = {}) =>
      [...this.menus.values()].filter(
        (m) => !where?.status || m.status === where.status,
      ).length,
  };

  menuItem = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const item = {
        id,
        isVegetarian: true,
        isAvailable: true,
        description: null,
        createdAt: now,
        updatedAt: now,
        ...data,
      };
      this.menuItems.set(id, item);
      return item;
    },
    createMany: async ({ data }: any) => {
      for (const entry of data) {
        const id = this.nextId();
        const now = new Date();
        this.menuItems.set(id, {
          id,
          isVegetarian: true,
          isAvailable: true,
          description: null,
          createdAt: now,
          updatedAt: now,
          ...entry,
        });
      }
      return { count: data.length };
    },
    deleteMany: async ({ where }: any) => {
      let count = 0;
      for (const [id, item] of this.menuItems.entries()) {
        if (item.menuId === where.menuId) {
          this.menuItems.delete(id);
          count += 1;
        }
      }
      return { count };
    },
  };

  mealConsumption = {
    create: async ({ data }: any) => {
      const key = `${data.residencyId}:${new Date(data.mealDate).toISOString()}:${data.mealType}`;
      const conflict = [...this.mealConsumptions.values()].some(
        (c) =>
          `${c.residencyId}:${new Date(c.mealDate).toISOString()}:${c.mealType}` ===
          key,
      );
      if (conflict) this.conflict('meal_consumption_unique');
      const id = this.nextId();
      const now = new Date();
      const consumption = {
        id,
        consumedAt: now,
        createdAt: now,
        itemNamesSnapshot: [],
        ...data,
      };
      this.mealConsumptions.set(id, consumption);
      return consumption;
    },
    findMany: async ({ where }: any) =>
      [...this.mealConsumptions.values()].filter(
        (c) => !where?.tenantId || c.tenantId === where.tenantId,
      ),
  };

  auditLog = {
    create: async ({ data }: any) => {
      const id = this.nextId();
      const now = new Date();
      const log = {
        id,
        metadata: null,
        organizationId: null,
        createdAt: now,
        ...data,
      };
      this.auditLogs.set(id, log);
      return log;
    },
    findMany: async ({ where }: any) =>
      [...this.auditLogs.values()]
        .filter((r) => {
          if (where?.action && r.action !== where.action) return false;
          if (where?.entityId && r.entityId !== where.entityId) return false;
          if (
            where?.organizationId &&
            r.organizationId !== where.organizationId
          )
            return false;
          return true;
        })
        .sort((a, b) => b.createdAt - a.createdAt),
    count: async ({ where }: any = {}) =>
      [...this.auditLogs.values()].filter((r) => {
        if (where?.action && r.action !== where.action) return false;
        if (where?.entityId && r.entityId !== where.entityId) return false;
        return true;
      }).length,
  };

  private invoiceSequence = 0;

  $transaction = async (fn: (tx: this) => Promise<unknown>) => fn(this);
  $queryRaw = async () => {
    this.invoiceSequence += 1;
    return [{ nextval: this.invoiceSequence }];
  };
  onModuleInit = jest.fn();
  onModuleDestroy = jest.fn();
  enableShutdownHooks = jest.fn();

  seedSubscription(organizationId: string, status: string) {
    const id = this.nextId();
    const planId = [...this.saasPlans.keys()][0];
    const now = new Date();
    this.subscriptions.set(id, {
      id,
      organizationId,
      saasPlanId: planId,
      pendingSaasPlanId: null,
      status,
      startedAt: now,
      currentPeriodStart: now,
      currentPeriodEnd: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      nextBillingAt: new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: null,
      cancelledAt: null,
      createdAt: now,
      updatedAt: now,
    });
  }
}

describe('Phase 10: food, meals & menu (e2e)', () => {
  let app: INestApplication;
  let throttlerSpy: jest.SpyInstance;
  let fakePrisma: FakePrisma;

  beforeAll(async () => {
    throttlerSpy = jest
      .spyOn(ThrottlerGuard.prototype, 'canActivate')
      .mockResolvedValue(true);

    fakePrisma = new FakePrisma();
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(fakePrisma)
      .compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    throttlerSpy.mockRestore();
  });

  const server = () => app.getHttpServer();

  async function registerAndLogin(email: string) {
    const res = await request(server())
      .post('/api/v1/auth/register')
      .send({ name: 'Test User', email, password: 'password123' })
      .expect(201);
    return {
      token: res.body.data.tokens.accessToken as string,
      userId: res.body.data.user.id as string,
    };
  }

  async function createOrg(token: string, name: string) {
    const res = await request(server())
      .post('/api/v1/organizations')
      .set('Authorization', `Bearer ${token}`)
      .send({ name })
      .expect(201);
    return res.body.data.id as string;
  }

  async function createProperty(token: string, organizationId: string) {
    const res = await request(server())
      .post('/api/v1/properties')
      .set('Authorization', `Bearer ${token}`)
      .send({
        organizationId,
        name: 'Test Property',
        addressLine1: '1 Main St',
        city: 'Hyderabad',
        state: 'Telangana',
        postalCode: '500032',
      })
      .expect(201);
    return res.body.data.id as string;
  }

  async function createRoom(
    token: string,
    propertyId: string,
    roomNumber: string,
  ) {
    const res = await request(server())
      .post(`/api/v1/properties/${propertyId}/rooms`)
      .set('Authorization', `Bearer ${token}`)
      .send({ roomNumber, roomType: 'DOUBLE', capacity: 2 })
      .expect(201);
    return res.body.data.id as string;
  }

  async function createBed(
    token: string,
    propertyId: string,
    roomId: string,
    bedNumber: string,
  ) {
    const res = await request(server())
      .post(`/api/v1/properties/${propertyId}/rooms/${roomId}/beds`)
      .set('Authorization', `Bearer ${token}`)
      .send({ bedNumber })
      .expect(201);
    return res.body.data.id as string;
  }

  async function createTenant(token: string) {
    const res = await request(server())
      .post('/api/v1/tenants')
      .set('Authorization', `Bearer ${token}`)
      .expect(201);
    return res.body.data.id as string;
  }

  async function addMember(
    role: 'MANAGER' | 'STAFF',
    email: string,
    orgId: string,
  ) {
    const member = await registerAndLogin(email);
    await fakePrisma.organizationMembership.create({
      data: {
        userId: member.userId,
        organizationId: orgId,
        role,
        status: 'ACTIVE',
      },
    });
    return member;
  }

  async function setupOrgWithResidentTenant(suffix: string) {
    const owner = await registerAndLogin(`owner-${suffix}@example.com`);
    const orgId = await createOrg(owner.token, `Org ${suffix}`);
    const propertyId = await createProperty(owner.token, orgId);
    const roomId = await createRoom(owner.token, propertyId, `R-${suffix}`);
    const bedId = await createBed(
      owner.token,
      propertyId,
      roomId,
      `B-${suffix}`,
    );

    const tenantUser = await registerAndLogin(`tenant-${suffix}@example.com`);
    const tenantId = await createTenant(tenantUser.token);

    const residencyRes = await request(server())
      .post(`/api/v1/properties/${propertyId}/residencies`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ tenantId, startDate: '2027-01-01T00:00:00.000Z' })
      .expect(201);
    const residencyId = residencyRes.body.data.id as string;

    await request(server())
      .post(`/api/v1/residencies/${residencyId}/check-in`)
      .set('Authorization', `Bearer ${owner.token}`)
      .send({ bedId })
      .expect(200);

    return {
      owner,
      orgId,
      propertyId,
      roomId,
      bedId,
      tenantUser,
      tenantId,
      residencyId,
    };
  }

  describe('Food configuration + Model A (included in rent)', () => {
    let ctx: Awaited<ReturnType<typeof setupOrgWithResidentTenant>>;

    beforeAll(async () => {
      ctx = await setupOrgWithResidentTenant('modelA');
    });

    it('defaults to disabled before any configuration', async () => {
      const res = await request(server())
        .get(`/api/v1/properties/${ctx.propertyId}/food`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .expect(200);
      expect(res.body.data.enabled).toBe(false);
    });

    it('OWNER enables food with meals included in rent', async () => {
      const res = await request(server())
        .patch(`/api/v1/properties/${ctx.propertyId}/food`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({
          enabled: true,
          mealsIncludedInRent: true,
          includedMealTypes: ['BREAKFAST', 'LUNCH', 'DINNER'],
        })
        .expect(200);
      expect(res.body.data.includedMealTypes).toEqual([
        'BREAKFAST',
        'LUNCH',
        'DINNER',
      ]);
    });

    it('STAFF cannot update the configuration', async () => {
      const staff = await addMember(
        'STAFF',
        'staff-modelA@example.com',
        ctx.orgId,
      );
      await request(server())
        .patch(`/api/v1/properties/${ctx.propertyId}/food`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({ enabled: false })
        .expect(403);
    });

    it('tenant entitlement shows included meals and no subscription needed', async () => {
      const res = await request(server())
        .get('/api/v1/me/food/entitlement')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(res.body.data.includedMeals).toEqual([
        'BREAKFAST',
        'LUNCH',
        'DINNER',
      ]);
      expect(res.body.data.subscriptionMeals).toEqual([]);
    });

    it('no food subscription/invoice exists for this tenant (Model A never creates one)', async () => {
      const sub = await request(server())
        .get('/api/v1/me/food/subscription')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(sub.body.data).toBeNull();

      const invoices = await request(server())
        .get('/api/v1/me/food/invoices')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(invoices.body.data).toEqual([]);
    });
  });

  describe('Optional subscription (Model B) + Model C dedup', () => {
    let ctx: Awaited<ReturnType<typeof setupOrgWithResidentTenant>>;
    let planId: string;

    beforeAll(async () => {
      ctx = await setupOrgWithResidentTenant('modelBC');
      await request(server())
        .patch(`/api/v1/properties/${ctx.propertyId}/food`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({
          enabled: true,
          mealsIncludedInRent: true,
          includedMealTypes: ['BREAKFAST'],
          optionalSubscriptionEnabled: true,
        })
        .expect(200);

      const planRes = await request(server())
        .post(`/api/v1/properties/${ctx.propertyId}/food/plans`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({
          name: 'Lunch + Dinner',
          price: '2500.00',
          mealTypes: ['LUNCH', 'DINNER'],
        })
        .expect(201);
      planId = planRes.body.data.id;
    });

    it('tenant sees the ACTIVE plan available at their property', async () => {
      const res = await request(server())
        .get('/api/v1/me/food/plans')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(res.body.data.some((p: any) => p.id === planId)).toBe(true);
    });

    it('subscribing creates an ACTIVE subscription and an ISSUED invoice', async () => {
      const res = await request(server())
        .post('/api/v1/me/food/subscriptions')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({ foodPlanId: planId })
        .expect(201);
      expect(res.body.data.status).toBe('ACTIVE');
      expect(res.body.data.priceSnapshot).toBe('2500');

      const invoices = await request(server())
        .get('/api/v1/me/food/invoices')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(invoices.body.data).toHaveLength(1);
      expect(invoices.body.data[0].status).toBe('ISSUED');
    });

    it('rejects a second active subscription for the same residency', async () => {
      await request(server())
        .post('/api/v1/me/food/subscriptions')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({ foodPlanId: planId })
        .expect(409);
    });

    it('Model C: entitlement is BREAKFAST included, LUNCH+DINNER via subscription, never duplicated', async () => {
      const res = await request(server())
        .get('/api/v1/me/food/entitlement')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(res.body.data.includedMeals).toEqual(['BREAKFAST']);
      expect(res.body.data.subscriptionMeals).toEqual(['LUNCH', 'DINNER']);
    });

    it('pauses then resumes the subscription', async () => {
      const paused = await request(server())
        .post('/api/v1/me/food/subscription/pause')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(paused.body.data.status).toBe('PAUSED');

      const resumed = await request(server())
        .post('/api/v1/me/food/subscription/resume')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(resumed.body.data.status).toBe('ACTIVE');
    });

    it('cancels the subscription; historical invoice remains', async () => {
      const cancelled = await request(server())
        .post('/api/v1/me/food/subscription/cancel')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(cancelled.body.data.status).toBe('CANCELLED');

      const invoices = await request(server())
        .get('/api/v1/me/food/invoices')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(invoices.body.data).toHaveLength(1);
    });
  });

  describe('Menu: draft visibility, publish, daily update, weekly', () => {
    let ctx: Awaited<ReturnType<typeof setupOrgWithResidentTenant>>;
    let menuId: string;
    const today = new Date().toISOString().slice(0, 10);

    beforeAll(async () => {
      ctx = await setupOrgWithResidentTenant('menu');
      await request(server())
        .patch(`/api/v1/properties/${ctx.propertyId}/food`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({ enabled: true })
        .expect(200);

      const res = await request(server())
        .post(`/api/v1/properties/${ctx.propertyId}/food/menus`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({
          date: today,
          items: [
            { mealType: 'LUNCH', name: 'Paneer' },
            { mealType: 'LUNCH', name: 'Rice' },
          ],
        })
        .expect(201);
      menuId = res.body.data.id;
    });

    it('a DRAFT menu is not visible to the tenant dashboard', async () => {
      const res = await request(server())
        .get('/api/v1/me/food/menu')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(res.body.data).toBeNull();
    });

    it('OWNER can see the DRAFT menu directly', async () => {
      const res = await request(server())
        .get(`/api/v1/food/menus/${menuId}`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .expect(200);
      expect(res.body.data.status).toBe('DRAFT');
    });

    it('publishing makes it visible to the tenant immediately', async () => {
      await request(server())
        .post(`/api/v1/food/menus/${menuId}/publish`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .expect(200);

      const res = await request(server())
        .get('/api/v1/me/food/menu')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(res.body.data.status).toBe('PUBLISHED');
      const lunchItems = res.body.data.items.filter(
        (i: any) => i.mealType === 'LUNCH',
      );
      expect(lunchItems.map((i: any) => i.name)).toEqual(['Paneer', 'Rice']);
    });

    it('updating today’s menu changes what the tenant sees on the next fetch, live', async () => {
      await request(server())
        .patch(`/api/v1/food/menus/${menuId}`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({ items: [{ mealType: 'LUNCH', name: 'Chole' }] })
        .expect(200);

      // Republish is not required by this suite's flow: PATCH replaced
      // the item list on the same already-PUBLISHED row's items table -
      // the menu's own status is untouched by replaceItems, so the
      // tenant's next fetch already reflects the new item without any
      // extra tenant-side action (spec section 32).
      const res = await request(server())
        .get('/api/v1/me/food/menu')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      const lunchItems = res.body.data.items.filter(
        (i: any) => i.mealType === 'LUNCH',
      );
      expect(lunchItems.map((i: any) => i.name)).toEqual(['Chole']);
    });

    it('rejects creating a second menu for the same property/date (concurrency-shaped conflict)', async () => {
      await request(server())
        .post(`/api/v1/properties/${ctx.propertyId}/food/menus`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({ date: today })
        .expect(409);
    });

    it('weekly PUT creates/updates several days atomically, still DRAFT', async () => {
      const startDate = '2026-11-02';
      const res = await request(server())
        .put(`/api/v1/properties/${ctx.propertyId}/food/menus/week`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({
          days: [
            {
              date: '2026-11-02',
              items: [{ mealType: 'BREAKFAST', name: 'Poha' }],
            },
            {
              date: '2026-11-03',
              items: [{ mealType: 'BREAKFAST', name: 'Upma' }],
            },
          ],
        })
        .expect(200);
      expect(res.body.data).toHaveLength(2);
      expect(res.body.data.every((m: any) => m.status === 'DRAFT')).toBe(true);

      const week = await request(server())
        .get(
          `/api/v1/properties/${ctx.propertyId}/food/menus/week?startDate=${startDate}`,
        )
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .expect(200);
      expect(week.body.data).toHaveLength(2);
    });

    it('STAFF cannot publish a menu (read-only role)', async () => {
      const staff = await addMember(
        'STAFF',
        'staff-menu@example.com',
        ctx.orgId,
      );
      const draft = await request(server())
        .post(`/api/v1/properties/${ctx.propertyId}/food/menus`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({ date: '2026-12-01' })
        .expect(201);

      await request(server())
        .post(`/api/v1/food/menus/${draft.body.data.id}/publish`)
        .set('Authorization', `Bearer ${staff.token}`)
        .expect(403);
    });
  });

  describe('BOLA / IDOR: cross-tenant, cross-property, cross-organization isolation', () => {
    let ctxA: Awaited<ReturnType<typeof setupOrgWithResidentTenant>>;
    let ctxB: Awaited<ReturnType<typeof setupOrgWithResidentTenant>>;
    let menuAId: string;

    beforeAll(async () => {
      ctxA = await setupOrgWithResidentTenant('bolaA10');
      ctxB = await setupOrgWithResidentTenant('bolaB10');

      await request(server())
        .patch(`/api/v1/properties/${ctxA.propertyId}/food`)
        .set('Authorization', `Bearer ${ctxA.owner.token}`)
        .send({ enabled: true })
        .expect(200);

      const menuRes = await request(server())
        .post(`/api/v1/properties/${ctxA.propertyId}/food/menus`)
        .set('Authorization', `Bearer ${ctxA.owner.token}`)
        .send({ date: '2026-12-15' })
        .expect(201);
      menuAId = menuRes.body.data.id;
    });

    it('Org B’s owner cannot read Org A’s menu (404)', async () => {
      await request(server())
        .get(`/api/v1/food/menus/${menuAId}`)
        .set('Authorization', `Bearer ${ctxB.owner.token}`)
        .expect(404);
    });

    it('Org B’s owner cannot publish Org A’s menu, and no mutation occurs', async () => {
      await request(server())
        .post(`/api/v1/food/menus/${menuAId}/publish`)
        .set('Authorization', `Bearer ${ctxB.owner.token}`)
        .expect(404);

      const stillDraft = await request(server())
        .get(`/api/v1/food/menus/${menuAId}`)
        .set('Authorization', `Bearer ${ctxA.owner.token}`)
        .expect(200);
      expect(stillDraft.body.data.status).toBe('DRAFT');
    });

    it('Tenant B cannot see Org A’s food configuration (property isolation)', async () => {
      await request(server())
        .get(`/api/v1/properties/${ctxA.propertyId}/food`)
        .set('Authorization', `Bearer ${ctxB.tenantUser.token}`)
        .expect(404);
    });

    it('an outsider with no residency gets RESIDENCY_NOT_FOUND on /me/food', async () => {
      const outsider = await registerAndLogin('outsider-food10@example.com');
      await createTenant(outsider.token);
      const res = await request(server())
        .get('/api/v1/me/food/entitlement')
        .set('Authorization', `Bearer ${outsider.token}`)
        .expect(404);
      expect(res.body.error.code).toBe('RESIDENCY_NOT_FOUND');
    });
  });

  describe('Checkout ends an active food subscription', () => {
    it('checking out a residency EXPIREs its ACTIVE food subscription', async () => {
      const ctx = await setupOrgWithResidentTenant('checkout10');
      await request(server())
        .patch(`/api/v1/properties/${ctx.propertyId}/food`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({ enabled: true, optionalSubscriptionEnabled: true })
        .expect(200);
      const planRes = await request(server())
        .post(`/api/v1/properties/${ctx.propertyId}/food/plans`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({ name: 'Dinner Only', price: '1200.00', mealTypes: ['DINNER'] })
        .expect(201);

      const subRes = await request(server())
        .post('/api/v1/me/food/subscriptions')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({ foodPlanId: planRes.body.data.id })
        .expect(201);

      await request(server())
        .post(`/api/v1/residencies/${ctx.residencyId}/check-out`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .expect(200);

      const subAfter = await request(server())
        .get(`/api/v1/food/subscriptions/${subRes.body.data.id}`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .expect(200);
      expect(subAfter.body.data.status).toBe('EXPIRED');
    });
  });

  describe('Subscription access (SUBSCRIPTION_SUSPENDED wiring, reused from Phase 9)', () => {
    it('a SUSPENDED organization subscription blocks a tenant from subscribing to food', async () => {
      const ctx = await setupOrgWithResidentTenant('suspended10');
      await request(server())
        .patch(`/api/v1/properties/${ctx.propertyId}/food`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({ enabled: true, optionalSubscriptionEnabled: true })
        .expect(200);
      const planRes = await request(server())
        .post(`/api/v1/properties/${ctx.propertyId}/food/plans`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({ name: 'Any Plan', price: '1000.00', mealTypes: ['LUNCH'] })
        .expect(201);

      fakePrisma.seedSubscription(ctx.orgId, 'SUSPENDED');

      const res = await request(server())
        .post('/api/v1/me/food/subscriptions')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({ foodPlanId: planRes.body.data.id })
        .expect(403);
      expect(res.body.error.code).toBe('SUBSCRIPTION_SUSPENDED');
    });
  });

  describe('Meal consumption', () => {
    let ctx: Awaited<ReturnType<typeof setupOrgWithResidentTenant>>;

    beforeAll(async () => {
      ctx = await setupOrgWithResidentTenant('consumption10');
    });

    it('STAFF marks a meal as consumed', async () => {
      const staff = await addMember(
        'STAFF',
        'staff-consumption10@example.com',
        ctx.orgId,
      );
      const res = await request(server())
        .post(`/api/v1/properties/${ctx.propertyId}/food/meal-consumptions`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({
          residencyId: ctx.residencyId,
          mealType: 'DINNER',
          mealDate: '2026-10-05',
        })
        .expect(201);
      expect(res.body.data.mealType).toBe('DINNER');
    });

    it('rejects a duplicate consumption record for the same meal period', async () => {
      const staff = await addMember(
        'STAFF',
        'staff-consumption10b@example.com',
        ctx.orgId,
      );
      await request(server())
        .post(`/api/v1/properties/${ctx.propertyId}/food/meal-consumptions`)
        .set('Authorization', `Bearer ${staff.token}`)
        .send({
          residencyId: ctx.residencyId,
          mealType: 'DINNER',
          mealDate: '2026-10-05',
        })
        .expect(409);
    });

    it('the tenant can see their own meal history', async () => {
      const res = await request(server())
        .get('/api/v1/me/food/meals')
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(200);
      expect(res.body.data.length).toBeGreaterThanOrEqual(1);
    });
  });

  describe('Food administrative audit logging', () => {
    it('creating a food plan writes a FOOD_PLAN_CREATED AuditLog row with the full expected shape', async () => {
      const ctx = await setupOrgWithResidentTenant('audit10a');
      const res = await request(server())
        .post(`/api/v1/properties/${ctx.propertyId}/food/plans`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({ name: 'Audit Plan', price: '1500.00', mealTypes: ['LUNCH'] })
        .expect(201);

      const rows = await fakePrisma.auditLog.findMany({
        where: { action: 'FOOD_PLAN_CREATED', entityId: res.body.data.id },
      });
      expect(rows).toHaveLength(1);
      const row = rows[0];
      expect(row.actorUserId).toBe(ctx.owner.userId);
      expect(row.organizationId).toBe(ctx.orgId);
      expect(row.entityType).toBe('FoodPlan');
      expect(row.entityId).toBe(res.body.data.id);
      expect(row.action).toBe('FOOD_PLAN_CREATED');
      expect(row.metadata).toMatchObject({
        propertyId: ctx.propertyId,
        name: 'Audit Plan',
      });
      expect(row.createdAt).toBeInstanceOf(Date);
    });

    it('records the expected FOOD_MENU_* sequence: create -> publish -> live-update -> cancel', async () => {
      const ctx = await setupOrgWithResidentTenant('audit10b');
      const manager = await addMember(
        'MANAGER',
        'manager-audit10b@example.com',
        ctx.orgId,
      );

      const menu = await request(server())
        .post(`/api/v1/properties/${ctx.propertyId}/food/menus`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({
          date: '2027-06-01',
          items: [{ mealType: 'LUNCH', name: 'Paneer' }],
        })
        .expect(201);
      const menuId = menu.body.data.id;

      await request(server())
        .post(`/api/v1/food/menus/${menuId}/publish`)
        .set('Authorization', `Bearer ${manager.token}`)
        .expect(200);

      await request(server())
        .patch(`/api/v1/food/menus/${menuId}`)
        .set('Authorization', `Bearer ${manager.token}`)
        .send({ items: [{ mealType: 'LUNCH', name: 'Chole' }] })
        .expect(200);

      await request(server())
        .post(`/api/v1/food/menus/${menuId}/cancel`)
        .set('Authorization', `Bearer ${manager.token}`)
        .expect(200);

      const rows = await fakePrisma.auditLog.findMany({
        where: { entityId: menuId },
      });
      const actions = rows
        .slice()
        .sort((a: any, b: any) => a.createdAt - b.createdAt)
        .map((r: any) => r.action);
      expect(actions).toEqual([
        'FOOD_MENU_CREATED',
        'FOOD_MENU_PUBLISHED',
        'FOOD_MENU_UPDATED',
        'FOOD_MENU_CANCELLED',
      ]);
      expect(rows.every((r: any) => r.actorUserId === manager.userId)).toBe(
        true,
      );
      expect(rows.every((r: any) => r.organizationId === ctx.orgId)).toBe(true);
    });

    it('a cross-organization food plan update is rejected (404) and writes no audit row', async () => {
      const a = await setupOrgWithResidentTenant('audit10cA');
      const b = await setupOrgWithResidentTenant('audit10cB');
      const planA = await request(server())
        .post(`/api/v1/properties/${a.propertyId}/food/plans`)
        .set('Authorization', `Bearer ${a.owner.token}`)
        .send({ name: 'Org A Plan', price: '999.00', mealTypes: ['DINNER'] })
        .expect(201);

      const managerB = await addMember(
        'MANAGER',
        'manager-audit10cB@example.com',
        b.orgId,
      );
      await request(server())
        .patch(`/api/v1/food/plans/${planA.body.data.id}`)
        .set('Authorization', `Bearer ${managerB.token}`)
        .send({ name: 'Hijacked' })
        .expect(404);

      const rows = await fakePrisma.auditLog.findMany({
        where: { action: 'FOOD_PLAN_UPDATED', entityId: planA.body.data.id },
      });
      expect(rows).toHaveLength(0);
    });

    it('a tenant’s attempts to publish a menu / update configuration / update a plan are all rejected with no administrative audit row', async () => {
      const ctx = await setupOrgWithResidentTenant('audit10d');
      const planRes = await request(server())
        .post(`/api/v1/properties/${ctx.propertyId}/food/plans`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({
          name: 'Tenant Cannot Touch',
          price: '500.00',
          mealTypes: ['SNACK'],
        })
        .expect(201);
      const menuRes = await request(server())
        .post(`/api/v1/properties/${ctx.propertyId}/food/menus`)
        .set('Authorization', `Bearer ${ctx.owner.token}`)
        .send({ date: '2027-06-15' })
        .expect(201);

      await request(server())
        .post(`/api/v1/food/menus/${menuRes.body.data.id}/publish`)
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .expect(404);
      await request(server())
        .patch(`/api/v1/properties/${ctx.propertyId}/food`)
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({ enabled: true })
        .expect(404);
      await request(server())
        .patch(`/api/v1/food/plans/${planRes.body.data.id}`)
        .set('Authorization', `Bearer ${ctx.tenantUser.token}`)
        .send({ name: 'Renamed' })
        .expect(404);

      const publishRows = await fakePrisma.auditLog.findMany({
        where: {
          action: 'FOOD_MENU_PUBLISHED',
          entityId: menuRes.body.data.id,
        },
      });
      const configRows = (
        await fakePrisma.auditLog.findMany({
          where: { action: 'FOOD_CONFIGURATION_UPDATED' },
        })
      ).filter((r: any) => r.metadata?.propertyId === ctx.propertyId);
      const planRows = await fakePrisma.auditLog.findMany({
        where: { action: 'FOOD_PLAN_UPDATED', entityId: planRes.body.data.id },
      });
      expect(publishRows).toHaveLength(0);
      expect(configRows).toHaveLength(0);
      expect(planRows).toHaveLength(0);
    });

    it('SUPER_ADMIN reading the food overview never writes an audit row (reads are never audited)', async () => {
      const before = await fakePrisma.auditLog.count();
      const superAdmin = await registerAndLogin('sa-audit10@example.com');
      await fakePrisma.user.update({
        where: { id: superAdmin.userId },
        data: { platformRole: 'SUPER_ADMIN' },
      });
      await request(server())
        .get('/api/v1/admin/food/overview')
        .set('Authorization', `Bearer ${superAdmin.token}`)
        .expect(200);
      const after = await fakePrisma.auditLog.count();
      expect(after).toBe(before);
    });
  });

  describe('Super Admin platform visibility', () => {
    it('SUPER_ADMIN can read the food overview; a non-admin owner is denied', async () => {
      const superAdmin = await registerAndLogin('sa-food10@example.com');
      await fakePrisma.user.update({
        where: { id: superAdmin.userId },
        data: { platformRole: 'SUPER_ADMIN' },
      });

      const res = await request(server())
        .get('/api/v1/admin/food/overview')
        .set('Authorization', `Bearer ${superAdmin.token}`)
        .expect(200);
      expect(typeof res.body.data.totalPlans).toBe('number');

      const owner = await registerAndLogin('owner-adminfood10@example.com');
      const deniedRes = await request(server())
        .get('/api/v1/admin/food/overview')
        .set('Authorization', `Bearer ${owner.token}`)
        .expect(404);
      expect(deniedRes.body.error.code).toBe('PLATFORM_ADMIN_ACCESS_DENIED');
    });
  });
});
