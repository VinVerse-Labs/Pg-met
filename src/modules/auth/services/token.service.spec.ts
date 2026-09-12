import { JwtService } from '@nestjs/jwt';
import { TokenService } from './token.service';

function buildConfigService(overrides: Partial<Record<string, unknown>> = {}) {
  const jwtConfig = {
    accessSecret: 'access-secret-at-least-16-chars',
    accessExpiresIn: '15m',
    refreshSecret: 'refresh-secret-at-least-16-chars',
    refreshExpiresIn: '7d',
    ...overrides,
  };
  return { get: () => jwtConfig } as any;
}

describe('TokenService', () => {
  let tokenService: TokenService;

  beforeEach(() => {
    tokenService = new TokenService(new JwtService(), buildConfigService());
  });

  it('signs an access token containing only `sub` in its payload', () => {
    const { token } = tokenService.signAccessToken('user-1');
    const decoded = new JwtService().decode(token) as Record<string, unknown>;

    expect(decoded.sub).toBe('user-1');
    expect(Object.keys(decoded).sort()).toEqual(['exp', 'iat', 'sub']);
  });

  it('signs a refresh token with a unique jti each time', () => {
    const first = tokenService.signRefreshToken('user-1');
    const second = tokenService.signRefreshToken('user-1');

    expect(first.jti).not.toEqual(second.jti);
    expect(first.token).not.toEqual(second.token);
  });

  it('verifies a refresh token it just signed', async () => {
    const { token, jti } = tokenService.signRefreshToken('user-1');
    const payload = await tokenService.verifyRefreshToken(token);

    expect(payload).toMatchObject({ sub: 'user-1', jti });
  });

  it('rejects a refresh token signed with a different secret', async () => {
    const otherService = new TokenService(
      new JwtService(),
      buildConfigService({ refreshSecret: 'a-completely-different-secret!!' }),
    );
    const { token } = otherService.signRefreshToken('user-1');

    await expect(tokenService.verifyRefreshToken(token)).rejects.toThrow();
  });

  it('rejects an access token presented as a refresh token (different secret)', async () => {
    const { token } = tokenService.signAccessToken('user-1');

    await expect(tokenService.verifyRefreshToken(token)).rejects.toThrow();
  });

  it('hashes the same token deterministically, and different tokens differently', () => {
    const hashA1 = tokenService.hashToken('token-a');
    const hashA2 = tokenService.hashToken('token-a');
    const hashB = tokenService.hashToken('token-b');

    expect(hashA1).toEqual(hashA2);
    expect(hashA1).not.toEqual(hashB);
    // The raw token must never be recoverable/present in what gets stored.
    expect(hashA1).not.toContain('token-a');
  });
});
