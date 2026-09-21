import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { Notification, Prisma } from '@prisma/client';
import { PrismaService } from '../../../database/prisma.service';
import { AppException } from '../../../common/exceptions/app.exception';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import {
  PaginatedResult,
  paginationSkipTake,
} from '../../../common/dto/pagination-query.dto';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { NotificationTemplateService } from './notification-template.service';
import { NotificationDeliveryService } from './notification-delivery.service';
import { PublishNotificationInput } from '../types/publish-notification.input';
import { ListNotificationsQueryDto } from '../dto/list-notifications.query.dto';
import { NotificationResponseDto } from '../dto/notification-response.dto';

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly templates: NotificationTemplateService,
    private readonly delivery: NotificationDeliveryService,
  ) {}

  // The one and only Notification creation path (spec section 84) -
  // called exclusively by NotificationEventService, never directly by a
  // controller. Idempotency (spec section 31/76): a retried business
  // event reuses the exact same `idempotencyKey`, so the second `create`
  // call hits the column's own @unique and is treated as "already
  // published," returning the original row without re-attempting
  // delivery - never a second notification, never a second round of
  // deliveries. Delivery is attempted only for the notification this call
  // actually created (never for one that already existed), and a delivery
  // failure is always caught inside NotificationDeliveryService itself -
  // `publish` never throws because of it (spec section 45).
  async publish(input: PublishNotificationInput): Promise<Notification> {
    const rendered = this.templates.render(input.type, input.templateVars);

    let notification: Notification;
    let alreadyExisted = false;
    try {
      notification = await this.prisma.notification.create({
        data: {
          userId: input.userId,
          organizationId: input.organizationId ?? null,
          propertyId: input.propertyId ?? null,
          type: input.type,
          title: rendered.title,
          body: rendered.body,
          data: (input.data ?? undefined) as Prisma.InputJsonValue,
          priority: input.priority ?? rendered.priority,
          idempotencyKey: input.idempotencyKey,
          expiresAt: input.expiresAt ?? null,
        },
      });
    } catch (error) {
      if (this.isUniqueViolation(error, ['idempotencyKey'])) {
        const existing = await this.prisma.notification.findUnique({
          where: { idempotencyKey: input.idempotencyKey },
        });
        if (existing) {
          alreadyExisted = true;
          notification = existing;
        } else {
          throw error;
        }
      } else {
        throw error;
      }
    }

    if (!alreadyExisted) {
      this.logger.log(
        `NOTIFICATION_CREATED notification=${notification.id} type=${input.type} user=${input.userId}`,
      );
      await this.delivery.deliverAll(notification);
    }
    return notification;
  }

  async findForUser(
    user: AuthenticatedUser,
    query: ListNotificationsQueryDto,
  ): Promise<PaginatedResult<NotificationResponseDto>> {
    const { skip, take } = paginationSkipTake(query);
    const where: Prisma.NotificationWhereInput = {
      userId: user.id,
      status: query.unreadOnly ? 'UNREAD' : undefined,
    };
    const [rows, total] = await Promise.all([
      this.prisma.notification.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip,
        take,
      }),
      this.prisma.notification.count({ where }),
    ]);
    return {
      items: rows.map(NotificationResponseDto.fromEntity),
      total,
      page: query.page ?? 1,
      limit: query.limit ?? 20,
    };
  }

  // Database-level aggregation (spec section 28/59) - never
  // `findMany` + JS `.length`.
  async getUnreadCount(user: AuthenticatedUser): Promise<number> {
    return this.prisma.notification.count({
      where: { userId: user.id, status: 'UNREAD' },
    });
  }

  async findOne(
    user: AuthenticatedUser,
    id: string,
  ): Promise<NotificationResponseDto> {
    const notification = await this.getOwnNotificationOrThrow(user, id);
    return NotificationResponseDto.fromEntity(notification);
  }

  // Atomic, idempotent mark-read (spec section 26/73): the WHERE clause
  // folds both ownership and the expected prior state into one
  // `updateMany`, the same atomic-conditional-update pattern every
  // lifecycle transition in this codebase uses since Phase 8. Already
  // READ, or two concurrent mark-read calls racing, both resolve to the
  // same successful READ result - never an error, never a duplicate
  // state, never another user's row (a mismatched userId simply never
  // matches the WHERE clause, so it falls through to the existence
  // check below and reports 404, not "0 rows affected").
  async markRead(
    user: AuthenticatedUser,
    id: string,
  ): Promise<NotificationResponseDto> {
    const result = await this.prisma.notification.updateMany({
      where: { id, userId: user.id, status: 'UNREAD' },
      data: { status: 'READ', readAt: new Date() },
    });
    if (result.count === 0) {
      // Either it doesn't exist/belong to this user (404), or it was
      // already READ (idempotent success) - getOwnNotificationOrThrow
      // tells these apart.
      await this.getOwnNotificationOrThrow(user, id);
    }
    const updated = await this.getOwnNotificationOrThrow(user, id);
    return NotificationResponseDto.fromEntity(updated);
  }

  // Only the authenticated user's own UNREAD rows are ever touched (spec
  // section 27) - the WHERE clause scopes to userId, never anything
  // client-supplied.
  async markAllRead(user: AuthenticatedUser): Promise<{ updated: number }> {
    const result = await this.prisma.notification.updateMany({
      where: { userId: user.id, status: 'UNREAD' },
      data: { status: 'READ', readAt: new Date() },
    });
    return { updated: result.count };
  }

  // BOLA-safe lookup (spec section 24/65): scoped to userId in the WHERE
  // clause itself, never "load by id, then check ownership after" - a
  // notification belonging to another user is indistinguishable from one
  // that doesn't exist at all.
  private async getOwnNotificationOrThrow(
    user: AuthenticatedUser,
    id: string,
  ): Promise<Notification> {
    const notification = await this.prisma.notification.findFirst({
      where: { id, userId: user.id },
    });
    if (!notification) {
      throw new AppException(
        ErrorCode.NOTIFICATION_NOT_FOUND,
        'Notification not found.',
        HttpStatus.NOT_FOUND,
      );
    }
    return notification;
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
