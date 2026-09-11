import { SetMetadata } from '@nestjs/common';

export const RAW_RESPONSE_KEY = 'rawResponse';

// Opts an endpoint out of the global success-envelope wrapping performed by
// ResponseInterceptor. Use for health checks and any response shape a
// third-party contract (infra probes, webhooks) dictates.
export const RawResponse = (): MethodDecorator & ClassDecorator =>
  SetMetadata(RAW_RESPONSE_KEY, true);
