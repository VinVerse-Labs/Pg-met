import { IdentityVerificationStatus } from '@prisma/client';

// The full set of transitions the KYC domain permits today. Expressed as a
// lookup table (not scattered if/else) so adding a future status, or a
// future allowed transition, is a one-line change reviewed in one place.
//
//   NOT_STARTED -> PENDING              (verification kicked off)
//   PENDING     -> VERIFIED | FAILED    (provider returned a result)
//   FAILED      -> PENDING              (user/owner retries)
//   VERIFIED    -> EXPIRED | REVOKED    (time-based lapse, or manual revoke)
//   EXPIRED     -> PENDING              (re-verification)
//   REVOKED     -> (none - terminal; a revoked verification always starts
//                   a brand new record, it never comes back to life)
const ALLOWED_TRANSITIONS: Record<
  IdentityVerificationStatus,
  IdentityVerificationStatus[]
> = {
  NOT_STARTED: ['PENDING'],
  PENDING: ['VERIFIED', 'FAILED'],
  FAILED: ['PENDING'],
  VERIFIED: ['EXPIRED', 'REVOKED'],
  EXPIRED: ['PENDING'],
  REVOKED: [],
};

export function isValidTransition(
  from: IdentityVerificationStatus,
  to: IdentityVerificationStatus,
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}
