import {
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CurrentUser } from '../../auth/decorators/current-user.decorator';
import { AuthenticatedUser } from '../../auth/strategies/jwt.strategy';
import { TenantApplicationsService } from '../services/tenant-applications.service';
import { ApplicationLifecycleService } from '../services/application-lifecycle.service';
import { ListApplicationsQueryDto } from '../dto/list-applications.query.dto';
import { ApplicationResponseDto } from '../dto/application-response.dto';

// Applicant-facing, BOLA-safe: every route is scoped to
// `applicantUserId === user.id` inside the service layer (404, not 403,
// for another applicant's row).
@ApiTags('tenant-discovery: my applications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('me/applications')
export class MyApplicationsController {
  constructor(
    private readonly applications: TenantApplicationsService,
    private readonly lifecycle: ApplicationLifecycleService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'List the caller’s own applications.' })
  async findAll(
    @CurrentUser() user: AuthenticatedUser,
    @Query() query: ListApplicationsQueryDto,
  ) {
    return this.applications.findManyForApplicant(user, query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of the caller’s own applications.' })
  @ApiResponse({ status: 200, type: ApplicationResponseDto })
  async findOne(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ApplicationResponseDto> {
    return this.applications.findOneForApplicant(user, id);
  }

  @Post(':id/withdraw')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Withdraw the caller’s own application.' })
  @ApiResponse({ status: 200, type: ApplicationResponseDto })
  async withdraw(
    @CurrentUser() user: AuthenticatedUser,
    @Param('id') id: string,
  ): Promise<ApplicationResponseDto> {
    return this.lifecycle.withdraw(user, id);
  }
}
