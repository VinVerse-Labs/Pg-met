import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { MembershipsModule } from '../memberships/memberships.module';
import { SubscriptionsModule } from '../subscriptions/subscriptions.module';
import { PlatformAdminModule } from '../platform-admin/platform-admin.module';
import { ComplaintsController } from './complaints.controller';
import { ComplaintLifecycleController } from './complaint-lifecycle.controller';
import { ComplaintCommentsController } from './complaint-comments.controller';
import { ComplaintAttachmentsController } from './complaint-attachments.controller';
import { AdminComplaintsController } from './admin-complaints.controller';
import { ComplaintsService } from './complaints.service';
import { ComplaintLifecycleService } from './complaint-lifecycle.service';
import { ComplaintCommentsService } from './complaint-comments.service';
import { ComplaintAttachmentsService } from './complaint-attachments.service';
import { ComplaintActivityService } from './complaint-activity.service';

@Module({
  imports: [
    AuthModule,
    MembershipsModule,
    SubscriptionsModule,
    PlatformAdminModule,
  ],
  controllers: [
    ComplaintsController,
    ComplaintLifecycleController,
    ComplaintCommentsController,
    ComplaintAttachmentsController,
    AdminComplaintsController,
  ],
  providers: [
    ComplaintsService,
    ComplaintLifecycleService,
    ComplaintCommentsService,
    ComplaintAttachmentsService,
    ComplaintActivityService,
  ],
})
export class ComplaintsModule {}
