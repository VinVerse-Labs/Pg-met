import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { AuditLogService } from '../audit-log/audit-log.service';
import { PaginationQueryDto } from '../../common/dto/pagination-query.dto';

class AdminAuditLogsQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MaxLength(100)
  action?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsUUID()
  organizationId?: string;
}

@ApiTags('platform-admin: audit-logs')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/audit-logs')
export class AdminAuditLogsController {
  constructor(private readonly auditLog: AuditLogService) {}

  @Get()
  @ApiOperation({
    summary:
      'List platform-admin audit events (server-generated only - clients can never submit an entry). SUPER_ADMIN only.',
  })
  async findAll(@Query() query: AdminAuditLogsQueryDto) {
    return this.auditLog.findAll(query);
  }
}
