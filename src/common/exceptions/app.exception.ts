import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../constants/error-code.enum';

// The only exception type application code should throw deliberately.
// Carrying a machine-readable ErrorCode alongside the HTTP status lets the
// global exception filter build a consistent error envelope without every
// module reinventing its own response shape.
export class AppException extends HttpException {
  public readonly code: ErrorCode;
  public readonly details?: unknown;

  constructor(
    code: ErrorCode,
    message: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
    details?: unknown,
  ) {
    super({ code, message, details }, status);
    this.code = code;
    this.details = details;
  }
}
