import { ApiProperty } from '@nestjs/swagger';
import {
  Complaint,
  ComplaintActivity,
  ComplaintActivityType,
  ComplaintCategory,
  ComplaintComment,
  ComplaintPriority,
  ComplaintStatus,
} from '@prisma/client';

// Tenant-facing shapes for /me/complaints. Deliberately narrower than the
// org-facing DTOs: no organizationId/tenantId/residencyId, no assignee or
// actor user ids (the tenant only needs to know *that* the property team
// is on it, never which staff member), and comments are PUBLIC only.

export type ComplaintParticipant = 'YOU' | 'PROPERTY_TEAM';
const PARTICIPANTS = ['YOU', 'PROPERTY_TEAM'];

export class MyComplaintResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  propertyId!: string;

  @ApiProperty()
  propertyName!: string;

  @ApiProperty({ nullable: true, type: String })
  roomId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  bedId!: string | null;

  @ApiProperty({ enum: ComplaintCategory })
  category!: ComplaintCategory;

  @ApiProperty({ enum: ComplaintPriority })
  priority!: ComplaintPriority;

  @ApiProperty({ enum: ComplaintStatus })
  status!: ComplaintStatus;

  @ApiProperty()
  title!: string;

  @ApiProperty()
  description!: string;

  @ApiProperty({
    description: 'Whether a property team member is assigned (never who).',
  })
  isAssigned!: boolean;

  @ApiProperty({ nullable: true, type: String })
  resolutionNote!: string | null;

  @ApiProperty({ nullable: true, type: Date })
  resolvedAt!: Date | null;

  @ApiProperty({ nullable: true, type: Date })
  closedAt!: Date | null;

  @ApiProperty()
  createdAt!: Date;

  @ApiProperty()
  updatedAt!: Date;

  static fromEntity(
    complaint: Complaint & { property: { name: string } },
  ): MyComplaintResponseDto {
    const dto = new MyComplaintResponseDto();
    dto.id = complaint.id;
    dto.propertyId = complaint.propertyId;
    dto.propertyName = complaint.property.name;
    dto.roomId = complaint.roomId;
    dto.bedId = complaint.bedId;
    dto.category = complaint.category;
    dto.priority = complaint.priority;
    dto.status = complaint.status;
    dto.title = complaint.title;
    dto.description = complaint.description;
    dto.isAssigned = complaint.assignedToUserId !== null;
    dto.resolutionNote = complaint.resolutionNote;
    dto.resolvedAt = complaint.resolvedAt;
    dto.closedAt = complaint.closedAt;
    dto.createdAt = complaint.createdAt;
    dto.updatedAt = complaint.updatedAt;
    return dto;
  }
}

export class MyComplaintCommentResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: PARTICIPANTS })
  author!: ComplaintParticipant;

  @ApiProperty()
  body!: string;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(
    comment: ComplaintComment,
    callerUserId: string,
  ): MyComplaintCommentResponseDto {
    const dto = new MyComplaintCommentResponseDto();
    dto.id = comment.id;
    dto.author =
      comment.authorUserId === callerUserId ? 'YOU' : 'PROPERTY_TEAM';
    dto.body = comment.body;
    dto.createdAt = comment.createdAt;
    return dto;
  }
}

export class MyComplaintActivityResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty({ enum: PARTICIPANTS })
  actor!: ComplaintParticipant;

  @ApiProperty({ enum: ComplaintActivityType })
  type!: ComplaintActivityType;

  @ApiProperty({ nullable: true, enum: ComplaintStatus })
  oldStatus!: ComplaintStatus | null;

  @ApiProperty({ nullable: true, enum: ComplaintStatus })
  newStatus!: ComplaintStatus | null;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(
    activity: ComplaintActivity,
    callerUserId: string,
  ): MyComplaintActivityResponseDto {
    const dto = new MyComplaintActivityResponseDto();
    dto.id = activity.id;
    dto.actor = activity.actorUserId === callerUserId ? 'YOU' : 'PROPERTY_TEAM';
    dto.type = activity.type;
    dto.oldStatus = activity.oldStatus;
    dto.newStatus = activity.newStatus;
    dto.createdAt = activity.createdAt;
    return dto;
  }
}
