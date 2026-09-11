import { ArgumentsHost, BadRequestException, HttpStatus } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { ErrorCode } from '../constants/error-code.enum';
import { AppException } from '../exceptions/app.exception';
import { AllExceptionsFilter } from './all-exceptions.filter';

function createHost(requestId = 'test-request-id') {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const response = { status };
  const request = { id: requestId, method: 'GET', url: '/api/v1/test' };

  const host = {
    switchToHttp: () => ({
      getResponse: () => response,
      getRequest: () => request,
    }),
  } as unknown as ArgumentsHost;

  return { host, status, json };
}

describe('AllExceptionsFilter', () => {
  let filter: AllExceptionsFilter;

  beforeEach(() => {
    filter = new AllExceptionsFilter();
  });

  it('formats an AppException using its own status, code and details', () => {
    const { host, status, json } = createHost();
    const exception = new AppException(
      ErrorCode.BED_ALREADY_OCCUPIED,
      'This bed is already occupied.',
      HttpStatus.CONFLICT,
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: ErrorCode.BED_ALREADY_OCCUPIED,
        message: 'This bed is already occupied.',
        details: undefined,
      },
      requestId: 'test-request-id',
    });
  });

  it('maps a framework BadRequestException to VALIDATION_FAILED', () => {
    const { host, status, json } = createHost();
    const exception = new BadRequestException('name should not be empty');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.BAD_REQUEST);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: ErrorCode.VALIDATION_FAILED,
          message: 'name should not be empty',
        }),
      }),
    );
  });

  it('maps a Prisma unique constraint violation (P2002) to 409 CONFLICT', () => {
    const { host, status, json } = createHost();
    const exception = new Prisma.PrismaClientKnownRequestError(
      'Unique constraint failed',
      { code: 'P2002', clientVersion: '5.22.0', meta: { target: ['email'] } },
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.CONFLICT);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: ErrorCode.CONFLICT }),
      }),
    );
  });

  it('maps a Prisma "record not found" (P2025) to 404 NOT_FOUND', () => {
    const { host, status, json } = createHost();
    const exception = new Prisma.PrismaClientKnownRequestError(
      'Record not found',
      { code: 'P2025', clientVersion: '5.22.0' },
    );

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.NOT_FOUND);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: ErrorCode.NOT_FOUND }),
      }),
    );
  });

  it('falls back to a generic 500 INTERNAL_SERVER_ERROR for unrecognised errors', () => {
    const { host, status, json } = createHost();
    const exception = new Error('something exploded');

    filter.catch(exception, host);

    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({
          code: ErrorCode.INTERNAL_SERVER_ERROR,
        }),
      }),
    );
  });

  it('never leaks the raw error message of an unrecognised error to the client', () => {
    const { host, json } = createHost();
    const exception = new Error('database password is hunter2');

    filter.catch(exception, host);

    const [[payload]] = json.mock.calls;
    expect(JSON.stringify(payload)).not.toContain('hunter2');
  });
});
