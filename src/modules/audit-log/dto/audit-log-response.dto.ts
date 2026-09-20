import { ApiProperty } from '@nestjs/swagger';
import { AuditLog } from '@prisma/client';

export class AuditLogResponseDto {
  @ApiProperty()
  id!: string;

  @ApiProperty()
  actorUserId!: string;

  @ApiProperty()
  action!: string;

  @ApiProperty()
  entityType!: string;

  @ApiProperty()
  entityId!: string;

  @ApiProperty({ nullable: true, type: String })
  organizationId!: string | null;

  @ApiProperty({ nullable: true, type: Object })
  metadata!: unknown;

  @ApiProperty()
  createdAt!: Date;

  static fromEntity(log: AuditLog): AuditLogResponseDto {
    const dto = new AuditLogResponseDto();
    dto.id = log.id;
    dto.actorUserId = log.actorUserId;
    dto.action = log.action;
    dto.entityType = log.entityType;
    dto.entityId = log.entityId;
    dto.organizationId = log.organizationId;
    dto.metadata = log.metadata;
    dto.createdAt = log.createdAt;
    return dto;
  }
}
