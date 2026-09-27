import { randomUUID } from 'node:crypto';
import {
  idPrefixFromTenantCode,
  normalizeTenantCode,
  tenantCodeFromId,
} from './tenant-code';

describe('tenant code', () => {
  it('formats as TN-XXXX-XXXX using the Crockford alphabet', () => {
    const code = tenantCodeFromId('8f3c2a1b-9e44-4c1d-8a2b-1234567890ab');
    expect(code).toMatch(/^TN-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);
  });

  it('is deterministic', () => {
    const id = randomUUID();
    expect(tenantCodeFromId(id)).toBe(tenantCodeFromId(id));
  });

  it('round-trips to the id prefix for many random ids', () => {
    for (let i = 0; i < 500; i += 1) {
      const id = randomUUID();
      expect(idPrefixFromTenantCode(tenantCodeFromId(id))).toBe(
        id.slice(0, 11),
      );
    }
  });

  it('handles an all-zero prefix', () => {
    const id = '00000000-0012-4000-8000-000000000000';
    expect(idPrefixFromTenantCode(tenantCodeFromId(id))).toBe('00000000-00');
  });

  it('accepts loose input: lowercase, spaces, missing prefix, look-alikes', () => {
    const code = tenantCodeFromId('8f3c2a1b-9e44-4c1d-8a2b-1234567890ab');
    const body = code.replace(/^TN-/, '').replace('-', '');
    expect(normalizeTenantCode(code.toLowerCase())).toBe(body);
    expect(normalizeTenantCode(body.replace(/(.{4})/, '$1 '))).toBe(body);
    expect(
      normalizeTenantCode(body.replace(/1/g, 'I').replace(/0/g, 'O')),
    ).toBe(body);
  });

  it.each(['', 'TN-', 'TN-12345', 'TN-1234-56789', 'TN-UUUU-UUUU', 'hello'])(
    'rejects %j',
    (value) => {
      expect(idPrefixFromTenantCode(value)).toBeNull();
    },
  );
});
