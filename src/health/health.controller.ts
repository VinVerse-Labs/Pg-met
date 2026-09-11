import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { HealthCheck, HealthCheckService } from '@nestjs/terminus';
import { RawResponse } from '../common/decorators/raw-response.decorator';
import { PrismaHealthIndicator } from './indicators/prisma-health.indicator';

// A passing check is not wrapped in the standard success envelope
// (@RawResponse) so it returns Terminus's own { status, info, error,
// details } body verbatim, which orchestrators (load balancers, k8s
// probes, uptime monitors) expect. A failing check throws, so it still
// goes through the global error envelope like everything else - the full
// Terminus payload survives there too, nested under error.details.
//
// Only checks the database: that is the one piece of "required
// infrastructure" this service currently depends on. A process-memory
// check was deliberately left out - a fixed heap threshold is either too
// tight for the Node GC's normal sawtooth or too loose to mean anything,
// and it says nothing about whether the API can actually serve requests.
@ApiTags('health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly prismaIndicator: PrismaHealthIndicator,
  ) {}

  @Get()
  @RawResponse()
  @HealthCheck()
  check() {
    return this.health.check([
      () => this.prismaIndicator.pingCheck('database'),
    ]);
  }
}
