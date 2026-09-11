import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Request, Response } from 'express';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import { RAW_RESPONSE_KEY } from '../decorators/raw-response.decorator';

export interface SuccessResponse<T> {
  success: true;
  data: T;
  requestId: string;
}

// Wraps every controller return value in a consistent envelope so clients
// never have to guess the response shape endpoint-by-endpoint. Endpoints
// that must return an unwrapped body (health checks consumed by infra
// tooling, file downloads, etc.) opt out with @RawResponse().
@Injectable()
export class ResponseInterceptor<T> implements NestInterceptor<
  T,
  SuccessResponse<T> | T
> {
  constructor(private readonly reflector: Reflector) {}

  intercept(
    context: ExecutionContext,
    next: CallHandler<T>,
  ): Observable<SuccessResponse<T> | T> {
    const isRaw = this.reflector.getAllAndOverride<boolean>(RAW_RESPONSE_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const response = context.switchToHttp().getResponse<Response>();
    const request = context.switchToHttp().getRequest<Request>();
    const requestId = (request.id as string) ?? '';
    response.setHeader('X-Request-Id', requestId);

    if (isRaw) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        success: true as const,
        data,
        requestId,
      })),
    );
  }
}
