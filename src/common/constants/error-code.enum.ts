// Machine-readable error codes returned in every error response's
// `error.code` field. Mobile/web clients should branch on these, never on
// `error.message` (which is human-readable and may change wording).
//
// Naming convention: SCREAMING_SNAKE_CASE, specific enough that a client can
// react differently to it than to a generic error of the same HTTP status.
export enum ErrorCode {
  // Generic / cross-cutting
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  CONFLICT = 'CONFLICT',
  RATE_LIMITED = 'RATE_LIMITED',
  SERVICE_UNAVAILABLE = 'SERVICE_UNAVAILABLE',
  INTERNAL_SERVER_ERROR = 'INTERNAL_SERVER_ERROR',

  // Auth (foundation for Phase 1)
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_REVOKED = 'TOKEN_REVOKED',
  TOKEN_INVALID = 'TOKEN_INVALID',

  // Tenancy / authorization (foundation for Phase 2)
  ORGANIZATION_ACCESS_DENIED = 'ORGANIZATION_ACCESS_DENIED',

  // Bed allocation (foundation for Phase 4)
  BED_ALREADY_OCCUPIED = 'BED_ALREADY_OCCUPIED',
  TENANT_ALREADY_ALLOCATED = 'TENANT_ALREADY_ALLOCATED',
}
