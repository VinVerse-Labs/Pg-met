import { ApiProperty } from '@nestjs/swagger';
import { IsUUID } from 'class-validator';

// No propertyId/residencyId/tenantId field - all derived server-side from
// the caller's own current residency, the same "never trust client
// relationships" rule Phase 9's CreateComplaintDto already established.
export class CreateFoodSubscriptionDto {
  @ApiProperty()
  @IsUUID()
  foodPlanId!: string;
}
