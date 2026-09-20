import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { PropertiesModule } from '../properties/properties.module';
import { ResidenciesModule } from '../residencies/residencies.module';
import { ResidencyInvoicesController } from './residency-invoices.controller';
import { PropertyInvoicesController } from './property-invoices.controller';
import { InvoicesController } from './invoices.controller';
import { InvoicesService } from './invoices.service';

@Module({
  imports: [AuthModule, MembershipsModule, PropertiesModule, ResidenciesModule],
  controllers: [
    ResidencyInvoicesController,
    PropertyInvoicesController,
    InvoicesController,
  ],
  providers: [InvoicesService],
})
export class InvoicesModule {}
