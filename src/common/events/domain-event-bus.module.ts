import { Global, Module } from '@nestjs/common';
import { DomainEventBusService } from './domain-event-bus.service';

// @Global so every business module (Residencies, Invoices, Payments,
// Complaints, Food, Subscriptions) can inject DomainEventBusService
// without each one importing this module explicitly - the same
// "infrastructure every module needs" role PrismaModule already plays.
@Global()
@Module({
  providers: [DomainEventBusService],
  exports: [DomainEventBusService],
})
export class DomainEventBusModule {}
