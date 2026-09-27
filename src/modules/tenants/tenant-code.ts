// A short, human-friendly *display form* of a Tenant id, e.g. "TN-3K7Q-9XZ2".
//
// Tenant ids are UUID v4s (`@default(uuid())`), which are unreadable over the
// phone or on a whiteboard. The code is derived deterministically from the
// id's first 40 bits (10 hex digits, all random in a v4 UUID) encoded as 8
// Crockford base32 characters - no new column, no migration, and the UUID
// stays the only real key everywhere. 40 bits keeps an accidental clash
// negligible at realistic scale (~0.005% for 10,000 tenants); a clash is
// still handled explicitly (TENANT_CODE_AMBIGUOUS), never guessed.
//
// Crockford's alphabet omits I, L, O and U, and decoding maps the look-alike
// characters back (I/L -> 1, O -> 0), so a code read aloud or handwritten
// still resolves.

const ALPHABET = '0123456789ABCDEFGHJKMNPQRSTVWXYZ';
const PREFIX = 'TN';
const CODE_LENGTH = 8;
const HEX_DIGITS = 10;

export function tenantCodeFromId(tenantId: string): string {
  const hex = tenantId.replace(/-/g, '').slice(0, HEX_DIGITS);
  if (!/^[0-9a-fA-F]{10}$/.test(hex)) {
    throw new Error('tenantCodeFromId expects a UUID tenant id.');
  }
  let value = BigInt(`0x${hex}`);
  let encoded = '';
  for (let i = 0; i < CODE_LENGTH; i += 1) {
    encoded = ALPHABET[Number(value & 31n)] + encoded;
    value >>= 5n;
  }
  return `${PREFIX}-${encoded.slice(0, 4)}-${encoded.slice(4)}`;
}

/** Normalizes user input ("tn 3k7q 9xz2", "3K7Q-9XZ2", "TN-3K7Q-9XZ2") to its 8 code characters, or null if it isn't a valid code. */
export function normalizeTenantCode(input: string): string | null {
  let body = input
    .toUpperCase()
    .replace(/[\s-]/g, '')
    .replace(/I|L/g, '1')
    .replace(/O/g, '0');
  if (body.startsWith(PREFIX) && body.length === PREFIX.length + CODE_LENGTH) {
    body = body.slice(PREFIX.length);
  }
  if (body.length !== CODE_LENGTH) return null;
  for (const char of body) {
    if (!ALPHABET.includes(char)) return null;
  }
  return body;
}

/** The UUID prefix a code identifies, in UUID text form (e.g. "8f3c2a1b-9e"), or null for an invalid code. */
export function idPrefixFromTenantCode(input: string): string | null {
  const body = normalizeTenantCode(input);
  if (!body) return null;
  let value = 0n;
  for (const char of body) {
    value = (value << 5n) | BigInt(ALPHABET.indexOf(char));
  }
  const hex = value.toString(16).padStart(HEX_DIGITS, '0');
  return `${hex.slice(0, 8)}-${hex.slice(8)}`;
}
