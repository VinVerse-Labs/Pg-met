import { Injectable, NestMiddleware } from '@nestjs/common';
import { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'crypto';

const REQUEST_ID_HEADER = 'x-request-id';

declare module 'express' {
  interface Request {
    id: string;
  }
}

// Assigns a unique ID to every request, reusing one supplied by an upstream
// gateway/load balancer when present. Runs before routing so every log
// line, error response, and success envelope can carry the same ID for
// end-to-end tracing across services.
@Injectable()
export class RequestIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[REQUEST_ID_HEADER];
    req.id = (Array.isArray(incoming) ? incoming[0] : incoming) ?? randomUUID();
    res.setHeader('X-Request-Id', req.id);
    next();
  }
}
