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

  // Auth (Phase 1)
  INVALID_CREDENTIALS = 'INVALID_CREDENTIALS',
  TOKEN_EXPIRED = 'TOKEN_EXPIRED',
  TOKEN_REVOKED = 'TOKEN_REVOKED',
  TOKEN_INVALID = 'TOKEN_INVALID',
  ACCOUNT_SUSPENDED = 'ACCOUNT_SUSPENDED',
  ACCOUNT_INACTIVE = 'ACCOUNT_INACTIVE',

  // Identity verification / KYC (Phase 1 foundation)
  INVALID_STATE_TRANSITION = 'INVALID_STATE_TRANSITION',

  // Tenancy / authorization (Phase 2)
  ORGANIZATION_NOT_FOUND = 'ORGANIZATION_NOT_FOUND',
  ORGANIZATION_ACCESS_DENIED = 'ORGANIZATION_ACCESS_DENIED',
  ORGANIZATION_SUSPENDED = 'ORGANIZATION_SUSPENDED',
  PROPERTY_NOT_FOUND = 'PROPERTY_NOT_FOUND',
  PROPERTY_ACCESS_DENIED = 'PROPERTY_ACCESS_DENIED',
  INSUFFICIENT_ROLE = 'INSUFFICIENT_ROLE',
  DUPLICATE_MEMBERSHIP = 'DUPLICATE_MEMBERSHIP',
  // Reserved for the future membership-management/invitation endpoints
  // (see MembershipsService docs) - unused by any Phase 2 endpoint today.
  MEMBERSHIP_NOT_FOUND = 'MEMBERSHIP_NOT_FOUND',

  // Property structure: rooms & beds (Phase 3)
  ROOM_NOT_FOUND = 'ROOM_NOT_FOUND',
  BED_NOT_FOUND = 'BED_NOT_FOUND',
  PROPERTY_NOT_ACTIVE = 'PROPERTY_NOT_ACTIVE',
  ROOM_NOT_ACTIVE = 'ROOM_NOT_ACTIVE',
  ROOM_CAPACITY_EXCEEDED = 'ROOM_CAPACITY_EXCEEDED',
  ROOM_CAPACITY_BELOW_BED_COUNT = 'ROOM_CAPACITY_BELOW_BED_COUNT',

  // Tenants, residency & bed allocation (Phase 4)
  TENANT_NOT_FOUND = 'TENANT_NOT_FOUND',
  RESIDENCY_NOT_FOUND = 'RESIDENCY_NOT_FOUND',
  INVALID_RESIDENCY_STATE = 'INVALID_RESIDENCY_STATE',
  INVALID_CHECKOUT = 'INVALID_CHECKOUT',
  BED_NOT_ACTIVE = 'BED_NOT_ACTIVE',
  // "Occupied" (an existing ACTIVE BedAllocation on this bed) - distinct
  // from BED_NOT_ACTIVE, which is about the bed's own physical lifecycle
  // status (ARCHIVED/INACTIVE), not who is currently living in it.
  BED_ALREADY_OCCUPIED = 'BED_ALREADY_OCCUPIED',
  // A tenant already has a non-terminal (PENDING/ACTIVE/NOTICE_PERIOD)
  // residency - see "one active residency per tenant" in ResidenciesService.
  TENANT_ALREADY_ALLOCATED = 'TENANT_ALREADY_ALLOCATED',

  // Rent & invoices (Phase 5)
  RENT_PLAN_NOT_FOUND = 'RENT_PLAN_NOT_FOUND',
  INVALID_RENT_PLAN = 'INVALID_RENT_PLAN',
  INVOICE_NOT_FOUND = 'INVOICE_NOT_FOUND',
  INVOICE_ALREADY_ISSUED = 'INVOICE_ALREADY_ISSUED',
  INVOICE_ALREADY_VOID = 'INVOICE_ALREADY_VOID',
  // Covers both the application-level pre-check and the unique-constraint
  // violation caught under a concurrent race - see
  // InvoicesService.generateForResidency.
  DUPLICATE_BILLING_PERIOD = 'DUPLICATE_BILLING_PERIOD',
  INVALID_INVOICE_STATE = 'INVALID_INVOICE_STATE',
  INVALID_BILLING_PERIOD = 'INVALID_BILLING_PERIOD',

  // Tenant payments, platform fee & owner settlement (Phase 6)
  PAYMENT_NOT_FOUND = 'PAYMENT_NOT_FOUND',
  INVALID_PAYMENT_AMOUNT = 'INVALID_PAYMENT_AMOUNT',
  // requestedAmount > outstanding balance (spec sections 16/29).
  AMOUNT_EXCEEDS_OUTSTANDING_BALANCE = 'AMOUNT_EXCEEDS_OUTSTANDING_BALANCE',
  // The invoice has no outstanding balance left to pay (already PAID) or
  // is VOID/DRAFT (not yet issued) - either way, not payable right now.
  INVOICE_NOT_PAYABLE = 'INVOICE_NOT_PAYABLE',
  INVALID_PAYMENT_STATE = 'INVALID_PAYMENT_STATE',
  PAYMENT_GATEWAY_ERROR = 'PAYMENT_GATEWAY_ERROR',
  INVALID_WEBHOOK_SIGNATURE = 'INVALID_WEBHOOK_SIGNATURE',
  IDEMPOTENCY_KEY_CONFLICT = 'IDEMPOTENCY_KEY_CONFLICT',
  REFUND_NOT_ALLOWED = 'REFUND_NOT_ALLOWED',
}
