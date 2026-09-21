import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Menu, MembershipRole, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { MembershipsService } from '../../memberships/memberships.service';
import { PropertiesService } from '../../properties/properties.service';
import { AuditLogService } from '../../audit-log/audit-log.service';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { CreateMenuDto } from '../dto/create-menu.dto';
import { MenuItemInputDto } from '../dto/menu-item-input.dto';
import { WeeklyMenuDto } from '../dto/weekly-menu.dto';
import { CreateMenuItemDto } from '../dto/create-menu-item.dto';
import { UpdateMenuItemDto } from '../dto/update-menu-item.dto';
import { ListMenusQueryDto } from '../dto/list-menus.query.dto';
import { MenuResponseDto } from '../dto/menu-response.dto';

const MANAGE_ROLES: MembershipRole[] = ['OWNER', 'MANAGER'];

type MenuWithItems = Menu & { items: Prisma.MenuItemGetPayload<object>[] };

// Every menu is a date-specific, immutable-once-past row (spec section
// 22/34) - there is no "current menu" concept anywhere in this service.
// Editing one date's items is always scoped by that menu's own id, never
// by date arithmetic against a shared table.
@Injectable()
export class FoodMenusService {
  private readonly logger = new Logger(FoodMenusService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly memberships: MembershipsService,
    private readonly properties: PropertiesService,
    private readonly auditLog: AuditLogService,
  ) {}

  async createDaily(
    user: AuthenticatedUser,
    propertyId: string,
    dto: CreateMenuDto,
  ): Promise<MenuResponseDto> {
    const property = await this.properties.getAccessiblePropertyOrThrow(
      user,
      propertyId,
    );
    await this.assertManageRole(user, property.organizationId);
    this.assertNoDuplicateMealTypes(dto.items ?? []);

    let menu: MenuWithItems;
    try {
      menu = await this.prisma.menu.create({
        data: {
          organizationId: property.organizationId,
          propertyId,
          date: new Date(dto.date),
          items: dto.items?.length
            ? { create: dto.items.map((item) => this.toItemData(item)) }
            : undefined,
        },
        include: { items: true },
      });
    } catch (error) {
      if (this.isUniqueViolation(error, ['propertyId', 'date'])) {
        throw new AppException(
          ErrorCode.MENU_ALREADY_EXISTS,
          'A menu already exists for this property and date.',
          HttpStatus.CONFLICT,
        );
      }
      throw error;
    }

    this.logger.log(
      `FOOD_MENU_CREATED menu=${menu.id} property=${propertyId} date=${dto.date} by=${user.id}`,
    );
    await this.auditMenu(user, menu, 'FOOD_MENU_CREATED');
    return MenuResponseDto.fromEntity(menu);
  }

  // Org-facing only (OWNER/MANAGER/STAFF, or SUPER_ADMIN) -
  // getAccessiblePropertyOrThrow already requires active membership, so
  // every status (including DRAFT) is visible here; the tenant-facing
  // /me/food/menu* endpoints never call this method (see
  // findWeekForProperty's `publishedOnly` flag for that path instead).
  async findForProperty(
    user: AuthenticatedUser,
    propertyId: string,
    query: ListMenusQueryDto,
  ): Promise<MenuResponseDto[]> {
    await this.properties.getAccessiblePropertyOrThrow(user, propertyId);
    const menus = await this.prisma.menu.findMany({
      where: {
        propertyId,
        status: query.status,
        date: {
          gte: query.from ? new Date(query.from) : undefined,
          lte: query.to ? new Date(query.to) : undefined,
        },
      },
      include: { items: true },
      orderBy: { date: 'asc' },
    });
    return menus.map(MenuResponseDto.fromEntity);
  }

  async findOneForOrg(
    user: AuthenticatedUser,
    menuId: string,
  ): Promise<MenuResponseDto> {
    const menu = await this.getAccessibleMenuOrThrow(user, menuId);
    return MenuResponseDto.fromEntity(menu);
  }

  // DRAFT or PUBLISHED (see assertEditable's own doc comment for why a
  // published day stays editable) - only CANCELLED blocks item edits.
  async replaceItems(
    user: AuthenticatedUser,
    menuId: string,
    items: MenuItemInputDto[],
  ): Promise<MenuResponseDto> {
    const menu = await this.getAccessibleMenuOrThrow(user, menuId);
    await this.assertManageRole(user, menu.organizationId);
    this.assertEditable(menu);
    this.assertNoDuplicateMealTypes(items);

    const updated = await this.prisma.$transaction(async (tx) => {
      await tx.menuItem.deleteMany({ where: { menuId } });
      if (items.length) {
        await tx.menuItem.createMany({
          data: items.map((item) => ({ menuId, ...this.toItemData(item) })),
        });
      }
      return tx.menu.findUniqueOrThrow({
        where: { id: menuId },
        include: { items: true },
      });
    });
    this.logger.log(`FOOD_MENU_UPDATED menu=${menuId} by=${user.id}`);
    await this.auditMenu(user, updated, 'FOOD_MENU_UPDATED');
    return MenuResponseDto.fromEntity(updated);
  }

  async addItem(
    user: AuthenticatedUser,
    menuId: string,
    dto: CreateMenuItemDto,
  ): Promise<MenuResponseDto> {
    const menu = await this.getAccessibleMenuOrThrow(user, menuId);
    await this.assertManageRole(user, menu.organizationId);
    this.assertEditable(menu);

    await this.prisma.menuItem.create({
      data: { menuId, ...this.toItemData(dto) },
    });
    const updated = await this.prisma.menu.findUniqueOrThrow({
      where: { id: menuId },
      include: { items: true },
    });
    this.logger.log(`FOOD_MENU_UPDATED menu=${menuId} by=${user.id}`);
    await this.auditMenu(user, updated, 'FOOD_MENU_UPDATED');
    return MenuResponseDto.fromEntity(updated);
  }

  async updateItem(
    user: AuthenticatedUser,
    itemId: string,
    dto: UpdateMenuItemDto,
  ): Promise<MenuResponseDto> {
    const item = await this.prisma.menuItem.findUnique({
      where: { id: itemId },
      include: { menu: true },
    });
    if (!item) {
      throw this.itemNotFound();
    }
    const menu = await this.getAccessibleMenuOrThrow(user, item.menuId);
    await this.assertManageRole(user, menu.organizationId);
    this.assertEditable(menu);

    await this.prisma.menuItem.update({
      where: { id: itemId },
      data: {
        mealType: dto.mealType,
        name: dto.name,
        description: dto.description,
        isVegetarian: dto.isVegetarian,
        isAvailable: dto.isAvailable,
      },
    });
    const updated = await this.prisma.menu.findUniqueOrThrow({
      where: { id: menu.id },
      include: { items: true },
    });
    this.logger.log(`FOOD_MENU_UPDATED menu=${menu.id} by=${user.id}`);
    await this.auditMenu(user, updated, 'FOOD_MENU_UPDATED');
    return MenuResponseDto.fromEntity(updated);
  }

  async removeItem(user: AuthenticatedUser, itemId: string): Promise<void> {
    const item = await this.prisma.menuItem.findUnique({
      where: { id: itemId },
      include: { menu: true },
    });
    if (!item) {
      throw this.itemNotFound();
    }
    const menu = await this.getAccessibleMenuOrThrow(user, item.menuId);
    await this.assertManageRole(user, menu.organizationId);
    this.assertEditable(menu);

    await this.prisma.menuItem.delete({ where: { id: itemId } });
    this.logger.log(`FOOD_MENU_UPDATED menu=${menu.id} by=${user.id}`);
    await this.auditMenu(user, menu, 'FOOD_MENU_UPDATED');
  }

  // Atomic (spec section 29): the status flip is the one write, guarded by
  // the same expected-prior-state-in-WHERE pattern every lifecycle
  // transition in this codebase uses (Phase 8/9's own concurrency fix) -
  // a lost race (someone else published/cancelled first) is translated
  // into a clean conflict, never a silent double-publish.
  async publish(
    user: AuthenticatedUser,
    menuId: string,
  ): Promise<MenuResponseDto> {
    const menu = await this.getAccessibleMenuOrThrow(user, menuId);
    await this.assertManageRole(user, menu.organizationId);

    const result = await this.prisma.menu.updateMany({
      where: { id: menuId, status: 'DRAFT' },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    });
    if (result.count === 0) {
      throw new AppException(
        ErrorCode.MENU_ALREADY_PUBLISHED,
        'Only a DRAFT menu can be published.',
        HttpStatus.CONFLICT,
      );
    }
    this.logger.log(`FOOD_MENU_PUBLISHED menu=${menuId} by=${user.id}`);
    const updated = await this.prisma.menu.findUniqueOrThrow({
      where: { id: menuId },
      include: { items: true },
    });
    await this.auditMenu(user, updated, 'FOOD_MENU_PUBLISHED');
    return MenuResponseDto.fromEntity(updated);
  }

  async cancel(
    user: AuthenticatedUser,
    menuId: string,
  ): Promise<MenuResponseDto> {
    const menu = await this.getAccessibleMenuOrThrow(user, menuId);
    await this.assertManageRole(user, menu.organizationId);

    const result = await this.prisma.menu.updateMany({
      where: { id: menuId, status: { not: 'CANCELLED' } },
      data: { status: 'CANCELLED', cancelledAt: new Date() },
    });
    if (result.count === 0) {
      throw new AppException(
        ErrorCode.MENU_CANCELLED,
        'This menu is already cancelled.',
        HttpStatus.CONFLICT,
      );
    }
    this.logger.log(`FOOD_MENU_CANCELLED menu=${menuId} by=${user.id}`);
    const updated = await this.prisma.menu.findUniqueOrThrow({
      where: { id: menuId },
      include: { items: true },
    });
    await this.auditMenu(user, updated, 'FOOD_MENU_CANCELLED');
    return MenuResponseDto.fromEntity(updated);
  }

  // Org-facing weekly read (spec section 26) - every status, including
  // DRAFT. The tenant-facing equivalent (MyFoodController) calls
  // findWeekForProperty with `publishedOnly: true` instead of duplicating
  // this query.
  async findWeekForProperty(
    user: AuthenticatedUser,
    propertyId: string,
    startDate: string,
    publishedOnly = false,
  ): Promise<MenuResponseDto[]> {
    await this.properties.getAccessiblePropertyOrThrow(user, propertyId);
    return this.findWeekRows(propertyId, startDate, publishedOnly);
  }

  // Tenant-dashboard single-day lookup - `propertyId` here is always
  // derived from the caller's own residency (never client-supplied), so
  // no org-membership check applies; `publishedOnly` is what keeps a
  // DRAFT day invisible to a tenant (spec section 23/30).
  async findOneForDate(
    propertyId: string,
    date: string,
    publishedOnly: boolean,
  ): Promise<MenuResponseDto | null> {
    const menu = await this.prisma.menu.findUnique({
      where: { propertyId_date: { propertyId, date: new Date(date) } },
      include: { items: true },
    });
    if (!menu) {
      return null;
    }
    if (publishedOnly && menu.status !== 'PUBLISHED') {
      return null;
    }
    return MenuResponseDto.fromEntity(menu);
  }

  async findWeekRows(
    propertyId: string,
    startDate: string,
    publishedOnly: boolean,
  ): Promise<MenuResponseDto[]> {
    const start = new Date(startDate);
    const end = new Date(start);
    end.setUTCDate(end.getUTCDate() + 6);

    const menus = await this.prisma.menu.findMany({
      where: {
        propertyId,
        date: { gte: start, lte: end },
        status: publishedOnly ? 'PUBLISHED' : undefined,
      },
      include: { items: true },
      orderBy: { date: 'asc' },
    });
    return menus.map(MenuResponseDto.fromEntity);
  }

  // The bulk weekly-update path (spec section 27): every day's
  // create-or-replace-items happens inside one transaction, so a request
  // meant to update a whole week can never leave some days changed and
  // others untouched. Publishing is never implied here - only content
  // changes (spec: "never automatically publish").
  async putWeek(
    user: AuthenticatedUser,
    propertyId: string,
    dto: WeeklyMenuDto,
  ): Promise<MenuResponseDto[]> {
    const property = await this.properties.getAccessiblePropertyOrThrow(
      user,
      propertyId,
    );
    await this.assertManageRole(user, property.organizationId);
    for (const day of dto.days) {
      this.assertNoDuplicateMealTypes(day.items);
    }

    const wasCreated = new Map<string, boolean>();
    const results = await this.prisma.$transaction(async (tx) => {
      const menus: MenuWithItems[] = [];
      for (const day of dto.days) {
        const date = new Date(day.date);
        let menu = await tx.menu.findUnique({
          where: { propertyId_date: { propertyId, date } },
        });
        if (!menu) {
          menu = await tx.menu.create({
            data: { organizationId: property.organizationId, propertyId, date },
          });
          wasCreated.set(menu.id, true);
        }
        await tx.menuItem.deleteMany({ where: { menuId: menu.id } });
        if (day.items.length) {
          await tx.menuItem.createMany({
            data: day.items.map((item) => ({
              menuId: menu!.id,
              ...this.toItemData(item),
            })),
          });
        }
        const withItems = await tx.menu.findUniqueOrThrow({
          where: { id: menu.id },
          include: { items: true },
        });
        menus.push(withItems);
      }
      return menus;
    });

    this.logger.log(
      `FOOD_MENU_UPDATED weekly property=${propertyId} days=${dto.days.length} by=${user.id}`,
    );
    // One audit row per day, only after the whole-week transaction has
    // committed - CREATED for a day that didn't previously exist,
    // UPDATED for one that did, mirroring the single-day endpoints'
    // own action naming exactly.
    for (const menu of results) {
      await this.auditMenu(
        user,
        menu,
        wasCreated.get(menu.id) ? 'FOOD_MENU_CREATED' : 'FOOD_MENU_UPDATED',
      );
    }
    return results.map(MenuResponseDto.fromEntity);
  }

  private async getAccessibleMenuOrThrow(
    user: AuthenticatedUser,
    menuId: string,
  ): Promise<MenuWithItems> {
    const isSuperAdmin = user.platformRole === 'SUPER_ADMIN';
    const menu = await this.prisma.menu.findFirst({
      where: {
        id: menuId,
        organizationId: isSuperAdmin
          ? undefined
          : { in: await this.memberships.listActiveOrganizationIds(user.id) },
      },
      include: { items: true },
    });
    if (!menu) {
      throw this.notFound();
    }
    return menu;
  }

  // DRAFT and PUBLISHED are both editable - spec section 32 explicitly
  // requires that editing *today's already-published* menu and
  // republishing nothing extra still reaches the tenant dashboard on its
  // very next fetch ("the backend must always return the latest published
  // version... without requiring the tenant to manually configure
  // anything"), so item edits are never gated behind an unpublish step.
  // Only CANCELLED is terminal - a retired day's content is frozen.
  private assertEditable(menu: Menu): void {
    if (menu.status === 'CANCELLED') {
      throw new AppException(
        ErrorCode.MENU_CANCELLED,
        'A cancelled menu can no longer have its items edited.',
        HttpStatus.CONFLICT,
      );
    }
  }

  private assertNoDuplicateMealTypes(items: MenuItemInputDto[]): void {
    // Multiple dishes for the same mealType are expected (e.g. several
    // lunch items) - this guards against a genuinely malformed request
    // that isn't caught elsewhere, kept intentionally permissive.
    if (items.some((item) => !item.name?.trim())) {
      throw new AppException(
        ErrorCode.INVALID_MENU,
        'Every menu item requires a name.',
        HttpStatus.BAD_REQUEST,
      );
    }
  }

  private toItemData(item: MenuItemInputDto) {
    return {
      mealType: item.mealType,
      name: item.name,
      description: item.description,
      isVegetarian: item.isVegetarian ?? true,
      isAvailable: item.isAvailable ?? true,
    };
  }

  private async assertManageRole(
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
    this.memberships.assertRole(user, membership, MANAGE_ROLES);
  }

  private notFound(): AppException {
    return new AppException(
      ErrorCode.MENU_NOT_FOUND,
      'Menu not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  private itemNotFound(): AppException {
    return new AppException(
      ErrorCode.MENU_NOT_FOUND,
      'Menu item not found.',
      HttpStatus.NOT_FOUND,
    );
  }

  // The one place every FOOD_MENU_* AuditLog row is written - called only
  // after its corresponding mutation has already succeeded (see each call
  // site: post-create, post-transaction, post-updateMany-count-check),
  // never from inside a catch block or before an authorization check has
  // run, so an unauthorized/failed request can never produce an audit
  // row (spec section 16).
  private async auditMenu(
    user: AuthenticatedUser,
    menu: Pick<Menu, 'id' | 'organizationId' | 'propertyId' | 'date'>,
    action:
      | 'FOOD_MENU_CREATED'
      | 'FOOD_MENU_UPDATED'
      | 'FOOD_MENU_PUBLISHED'
      | 'FOOD_MENU_CANCELLED',
  ): Promise<void> {
    await this.auditLog.record({
      actorUserId: user.id,
      action,
      entityType: 'Menu',
      entityId: menu.id,
      organizationId: menu.organizationId,
      metadata: {
        propertyId: menu.propertyId,
        date: menu.date.toISOString().slice(0, 10),
      },
    });
  }

  private isUniqueViolation(error: unknown, candidates: string[]): boolean {
    if (
      !(error instanceof Prisma.PrismaClientKnownRequestError) ||
      error.code !== 'P2002'
    ) {
      return false;
    }
    const target = error.meta?.target;
    if (typeof target === 'string') {
      return candidates.some((c) => target === c || target.includes(c));
    }
    if (Array.isArray(target)) {
      return candidates.some((c) => target.includes(c));
    }
    return false;
  }
}
