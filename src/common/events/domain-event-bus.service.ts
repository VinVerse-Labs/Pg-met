import { Injectable, Logger } from '@nestjs/common';

export type DomainEventListener<T = unknown> = (
  payload: T,
) => Promise<void> | void;

// The project's one in-process event mechanism (Phase 11 spec section 4/
// 47: "inspect whether the project already has one... do NOT introduce a
// large distributed-event architecture"). No event-emitter/queue library
// existed anywhere in this codebase before this phase, so this is a
// deliberately small addition - a typed wrapper around a plain
// `Map<eventName, listener[]>`, not `@nestjs/event-emitter` or a job
// queue. It exists specifically so business modules (Residencies,
// Invoices, Payments, Complaints, Food, Subscriptions) never import
// `NotificationsService`/any provider directly (spec section 33/105) -
// they only ever call `emit(eventName, payload)` on this one shared,
// global service.
//
// Reliability, honestly stated (spec section 47): `emit` runs its
// listeners in-process, synchronously with the caller's own async flow,
// after the caller's own business transaction has already committed
// (every call site in this codebase emits *after* its own `await
// this.prisma...`/`await this.prisma.$transaction(...)` call, never from
// inside one - see each business service's own emit call site). There is
// no outbox table and no at-least-once redelivery guarantee across a
// process crash between "business transaction committed" and "listener
// ran" - if the process dies in that narrow window, the notification for
// that one event is lost, the same way an uncaught exception before this
// phase would have lost any other post-commit side effect. This is
// documented as a known limitation (see README's "Phase 11" section) design
// so a future outbox/queue migration only has to change this one class's
// internals, never any of its callers.
//
// Failure isolation (spec section 45/77/106): a listener throwing is
// always caught here and logged, never rethrown to the emitting business
// service - a notification failure can never fail a rent payment, a menu
// publish, or any other business operation.
@Injectable()
export class DomainEventBusService {
  private readonly logger = new Logger(DomainEventBusService.name);
  private readonly listeners = new Map<string, DomainEventListener[]>();

  on<T>(eventName: string, listener: DomainEventListener<T>): void {
    const existing = this.listeners.get(eventName) ?? [];
    existing.push(listener as DomainEventListener);
    this.listeners.set(eventName, existing);
  }

  async emit<T>(eventName: string, payload: T): Promise<void> {
    const handlers = this.listeners.get(eventName) ?? [];
    for (const handler of handlers) {
      try {
        await handler(payload);
      } catch (error) {
        this.logger.error(
          `DOMAIN_EVENT_HANDLER_FAILED event=${eventName} error=${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
    }
  }
}
