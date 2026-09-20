import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { SaasPlansService } from './saas-plans.service';
import { SaasPlanResponseDto } from './dto/saas-plan-response.dto';

@ApiTags('saas-plans')
@ApiBearerAuth()
@Controller('saas/plans')
@UseGuards(JwtAuthGuard)
export class SaasPlansController {
  constructor(private readonly saasPlansService: SaasPlansService) {}

  @Get()
  @ApiOperation({
    summary: 'List active SaaS plans available to organizations.',
  })
  @ApiResponse({ status: 200, type: [SaasPlanResponseDto] })
  async findActive(): Promise<SaasPlanResponseDto[]> {
    return this.saasPlansService.findActive();
  }
}
