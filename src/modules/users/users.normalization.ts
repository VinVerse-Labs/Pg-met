// Kept as small, pure, independently-testable functions rather than inlined
// in UsersService - normalization must happen identically everywhere a
// user's email/phone is written or looked up (register, login lookup,
// future admin-created users), and identically is easiest to guarantee with
// one shared function rather than repeated inline `.trim().toLowerCase()`.

// Case-insensitive email matching is standard user expectation (RFC 5321
// technically allows a case-sensitive local part, but no mainstream mail
// provider treats it that way, and neither should this platform).
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

// Strips formatting characters a mobile keyboard/contacts picker commonly
// introduces (spaces, dashes, parentheses) while preserving a leading `+`
// for E.164-style international numbers. Deliberately not a full E.164
// validator/parser (e.g. libphonenumber) - Phase 1 only needs consistent
// storage/lookup, not carrier validation.
export function normalizePhone(phone: string): string {
  const trimmed = phone.trim();
  const hasPlus = trimmed.startsWith('+');
  const digits = trimmed.replace(/[^0-9]/g, '');
  return hasPlus ? `+${digits}` : digits;
}
