import { ApiProperty } from '@nestjs/swagger';
import {
  Complaint,
  ComplaintCategory,
  ComplaintPriority,
  ComplaintStatus,
} from '@prisma/client';

export class ComplaintResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  organizationId!: string;

  @ApiProperty()
  propertyId!: string;

  @ApiProperty()
  residencyId!: string;

  @ApiProperty()
  tenantId!: string;

  @ApiProperty({ nullable: true, type: String })
  roomId!: string | null;

  @ApiProperty({ nullable: true, type: String })
  bedId!: string | null;

  @ApiProperty()
  reportedByUserId!: string;

  @ApiProperty({ nullable: true, type: String })
  assignedToUserId!: string | null;

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

  static fromEntity(complaint: Complaint): ComplaintResponseDto {
    const dto = new ComplaintResponseDto();
    dto.id = complaint.id;
    dto.organizationId = complaint.organizationId;
    dto.propertyId = complaint.propertyId;
    dto.residencyId = complaint.residencyId;
    dto.tenantId = complaint.tenantId;
    dto.roomId = complaint.roomId;
    dto.bedId = complaint.bedId;
    dto.reportedByUserId = complaint.reportedByUserId;
    dto.assignedToUserId = complaint.assignedToUserId;
    dto.category = complaint.category;
    dto.priority = complaint.priority;
    dto.status = complaint.status;
    dto.title = complaint.title;
    dto.description = complaint.description;
    dto.resolutionNote = complaint.resolutionNote;
    dto.resolvedAt = complaint.resolvedAt;
    dto.closedAt = complaint.closedAt;
    dto.createdAt = complaint.createdAt;
    dto.updatedAt = complaint.updatedAt;
    return dto;
  }
}
