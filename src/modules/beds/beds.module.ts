import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { PropertiesModule } from '../properties/properties.module';
import { RoomsModule } from '../rooms/rooms.module';
import { BedsController } from './beds.controller';
import { BedsService } from './beds.service';

@Module({
  imports: [AuthModule, MembershipsModule, PropertiesModule, RoomsModule],
  controllers: [BedsController],
  providers: [BedsService],
})
export class BedsModule {}
