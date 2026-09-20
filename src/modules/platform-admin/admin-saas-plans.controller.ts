import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../auth/strategies/jwt.strategy';
import { PlatformAdminGuard } from './guards/platform-admin.guard';
import { SaasPlansService } from '../saas-plans/saas-plans.service';
import { CreateSaasPlanDto } from '../saas-plans/dto/create-saas-plan.dto';
import { UpdateSaasPlanDto } from '../saas-plans/dto/update-saas-plan.dto';
import { SaasPlanResponseDto } from '../saas-plans/dto/saas-plan-response.dto';
import { AuditLogService } from '../audit-log/audit-log.service';

@ApiTags('platform-admin: saas-plans')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, PlatformAdminGuard)
@Controller('admin/saas-plans')
export class AdminSaasPlansController {
  constructor(
    private readonly saasPlansService: SaasPlansService,
    private readonly auditLog: AuditLogService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List every SaaS plan, active and inactive. SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 200, type: [SaasPlanResponseDto] })
  async findAll(): Promise<SaasPlanResponseDto[]> {
    return this.saasPlansService.adminFindAll();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one SaaS plan. SUPER_ADMIN only.' })
  @ApiResponse({ status: 200, type: SaasPlanResponseDto })
  async findOne(@Param('id') id: string): Promise<SaasPlanResponseDto> {
    return this.saasPlansService.adminFindOneOrThrow(id);
  }

  @Post()
  @ApiOperation({
    summary:
      'Create a new SaaS plan. Price is set once, here, and never mutable afterward - a price change is always a new plan (spec: historical pricing must remain immutable). SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 201, type: SaasPlanResponseDto })
  async create(
    @CurrentUser() admin: AuthenticatedUser,
    @Body() dto: CreateSaasPlanDto,
  ): Promise<SaasPlanResponseDto> {
    const plan = await this.saasPlansService.adminCreate(dto);
    await this.auditLog.record({
      actorUserId: admin.id,
      action: 'SAAS_PLAN_CREATED',
      entityType: 'SaasPlan',
      entityId: plan.id,
      metadata: { name: plan.name, price: plan.price, currency: plan.currency },
    });
    return plan;
  }

  @Patch(':id')
  @ApiOperation({
    summary:
      'Update a plan’s cosmetic fields only (name/description) - price/currency can never be changed here. SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 200, type: SaasPlanResponseDto })
  async update(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
    @Body() dto: UpdateSaasPlanDto,
  ): Promise<SaasPlanResponseDto> {
    const plan = await this.saasPlansService.adminUpdate(id, dto);
    await this.auditLog.record({
      actorUserId: admin.id,
      action: 'SAAS_PLAN_UPDATED',
      entityType: 'SaasPlan',
      entityId: id,
      metadata: { name: dto.name, description: dto.description },
    });
    return plan;
  }

  @Post(':id/deactivate')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Retire a plan (status: INACTIVE) - never offered to a new subscription/plan-change again, but existing subscriptions/invoices referencing it are untouched. SUPER_ADMIN only.',
  })
  @ApiResponse({ status: 200, type: SaasPlanResponseDto })
  @ApiResponse({ status: 409, description: 'Already inactive.' })
  async deactivate(
    @CurrentUser() admin: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<SaasPlanResponseDto> {
    const plan = await this.saasPlansService.adminDeactivate(id);
    await this.auditLog.record({
      actorUserId: admin.id,
      action: 'SAAS_PLAN_DEACTIVATED',
      entityType: 'SaasPlan',
      entityId: id,
    });
    return plan;
  }
}
