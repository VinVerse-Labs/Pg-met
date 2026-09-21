import { ApiProperty } from '@nestjs/swagger';
import {
  ComplaintActivity,
  ComplaintActivityType,
  ComplaintPriority,
  ComplaintStatus,
} from '@prisma/client';

// Never contains a comment's body text (see ComplaintActivityService's
// doc comment) - safe to show to every legitimate complaint viewer,
// including the reporting tenant, regardless of PUBLIC/INTERNAL comment
// visibility rules.
export class ComplaintActivityResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  actorUserId!: string;

  @ApiProperty({ enum: ComplaintActivityType })
  type!: ComplaintActivityType;

  @ApiProperty({ nullable: true, enum: ComplaintStatus })
  oldStatus!: ComplaintStatus | null;

  @ApiProperty({ nullable: true, enum: ComplaintStatus })
  newStatus!: ComplaintStatus | null;

  @ApiProperty({ nullable: true, enum: ComplaintPriority })
  oldPriority!: ComplaintPriority | null;

  @ApiProperty({ nullable: true, enum: ComplaintPriority })
  newPriority!: ComplaintPriority | null;

  @ApiProperty({ nullable: true, type: String })
  oldAssigneeId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  newAssigneeId!: string | null;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(activity: ComplaintActivity): ComplaintActivityResponseDto {
    const dto = new ComplaintActivityResponseDto();
    dto.id = activity.id;
    dto.actorUserId = activity.actorUserId;
    dto.type = activity.type;
    dto.oldStatus = activity.oldStatus;
    dto.newStatus = activity.newStatus;
    dto.oldPriority = activity.oldPriority;
    dto.newPriority = activity.newPriority;
    dto.oldAssigneeId = activity.oldAssigneeId;
    dto.newAssigneeId = activity.newAssigneeId;
    dto.createdAt = activity.createdAt;
    return dto;
  }
}
