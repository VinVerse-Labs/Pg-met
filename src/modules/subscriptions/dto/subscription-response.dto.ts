import { ApiProperty } from '@nestjs/swagger';
import { OrganizationSubscription, SubscriptionStatus } from '@prisma/client';
import { SaasPlanResponseDto } from '../../saas-plans/dto/saas-plan-response.dto';

// `accessBlocked` is the one piece of derived state this DTO adds beyond
// raw columns - see SubscriptionAccessService. It answers "can this
// organization currently use the platform normally" without a client
// having to reimplement the SUSPENDED-check itself.
export class SubscriptionResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty({ type: SaasPlanResponseDto })
  plan!: SaasPlanResponseDto;

  @ApiProperty({ enum: SubscriptionStatus })
  status!: SubscriptionStatus;

  @ApiProperty()
  currentPeriodStart!: Date;

  @ApiProperty()
  currentPeriodEnd!: Date;

  @ApiProperty()
  nextBillingAt!: Date;

  @ApiProperty({ nullable: true, type: Date })
  gracePeriodEndsAt!: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  cancelledAt!: Date | null;

  @ApiProperty()
  accessBlocked!: boolean;

  static fromEntity(
    subscription: OrganizationSubscription & {
      saasPlan: Parameters<typeof SaasPlanResponseDto.fromEntity>[0];
    },
  ): SubscriptionResponseDto {
    const dto = new SubscriptionResponseDto();
    dto.id = subscription.id;
    dto.organizationId = subscription.organizationId;
    dto.plan = SaasPlanResponseDto.fromEntity(subscription.saasPlan);
    dto.status = subscription.status;
    dto.currentPeriodStart = subscription.currentPeriodStart;
    dto.currentPeriodEnd = subscription.currentPeriodEnd;
    dto.nextBillingAt = subscription.nextBillingAt;
    dto.gracePeriodEndsAt = subscription.gracePeriodEndsAt;
    dto.cancelledAt = subscription.cancelledAt;
    dto.accessBlocked = subscription.status === 'SUSPENDED';
    return dto;
  }
}
