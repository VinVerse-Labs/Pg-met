import { ExecutionContext } from '@nestjs/common';
import { ErrorCode } from '../../../common/constants/error-code.enum';
import { PlatformAdminGuard } from './platform-admin.guard';

function buildContext(user: any): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({ user }),
    }),
  } as unknown as ExecutionContext;
}

describe('PlatformAdminGuard', () => {
  let guard: PlatformAdminGuard;

  beforeEach(() => {
    guard = new PlatformAdminGuard();
  });

  it('allows a SUPER_ADMIN through', () => {
    const context = buildContext({ platformRole: 'SUPER_ADMIN' });
    expect(guard.canActivate(context)).toBe(true);
  });

  it.each(['USER'])(
    'rejects platformRole=%s with a 404, not a 403',
    (platformRole) => {
      const context = buildContext({ platformRole });
      try {
        guard.canActivate(context);
        fail('expected canActivate to throw');
      } catch (error: any) {
        expect(error.code).toBe(ErrorCode.PLATFORM_ADMIN_ACCESS_DENIED);
        expect(error.getStatus()).toBe(404);
      }
    },
  );

  it('rejects a missing user object safely', () => {
    const context = buildContext(undefined);
    expect(() => guard.canActivate(context)).toThrow();
  });
});
