# PG Backend

Backend API for a multi-tenant PG (Paying Guest) management SaaS platform.
NestJS + TypeScript + PostgreSQL (Prisma), built as a modular monolith.

This repository is backend-only. The mobile apps (owner/manager and
student) are separate React Native / Expo projects and are not part of
this codebase.

## Status: Phase 6 - Tenant Payments, Platform Fee & Owner Settlement

Phase 0 delivered the foundation: project setup, configuration, database
connectivity, the core multi-tenant data model, global error handling,
health checks and tooling.

Phase 1 added platform user identity, JWT authentication with
refresh-token rotation, multi-device sessions, and the
identity-verification (KYC) domain foundation.

Phase 2 added organizations, organization memberships, PG properties, and
the multi-tenant authorization layer that enforces "a user can only touch
data in an organization they actively belong to."

Phase 3 added the physical inventory underneath a property - rooms and
beds - reusing Phase 2's authorization mechanism all the way down the
chain.

Phase 4 introduced an actual resident: a `Tenant` profile on top of
`User`, a `Residency` representing one stay at one property, and
`BedAllocation` as the historical record of which bed a residency
occupied and when - plus the check-in/check-out actions that create and
end that history atomically.

Phase 5 added the financial obligation layer: `RentPlan` (the agreed
rent, with full history when it changes) and `Invoice`/`InvoiceItem` (an
immutable-once-issued snapshot of what a resident owes for one billing
period, including mid-period proration).

Phase 6 (this repository, current) adds the money-movement layer on top
of that: a tenant can actually pay an invoice through Razorpay, the
platform retains a small fee, and the remainder is tracked as a separate
owner settlement. `Payment` (an attempt/transaction against one invoice),
`PaymentAllocation` (how much of a payment counts toward an invoice's
paid balance), `PlatformFeeRule`, `OwnerPaymentAccount`,
`OwnerSettlement`, `Refund`, and `WebhookEvent` are all new this phase.
**Payments are the tenant's rent flow; the owner's own SaaS subscription
to this platform is a completely separate, not-yet-built domain.** Phase
6 intentionally does **not** include owner SaaS subscription billing
(plans, recharge, renewal, grace period, suspension - that's Phase 7),
PG applications, visit booking, complaints, food, notifications, the
student marketplace, or roommate matching (see "Roadmap" below).

## Tech stack

- Node.js + TypeScript (strict mode)
- NestJS 10 (REST, modular monolith)
- PostgreSQL + Prisma ORM
- Docker Compose (local Postgres only)
- class-validator / class-transformer (input validation)
- Swagger / OpenAPI (dev-only)
- Jest (unit + e2e)
- ESLint + Prettier

## Prerequisites

- Node.js 20+ and npm
- Docker Desktop (for local PostgreSQL) - or any PostgreSQL 14+ instance
  you already have running

## Setup

```bash
# 1. Install dependencies (also runs `prisma generate` via postinstall)
npm install

# 2. Copy the environment template and adjust if needed
cp .env.example .env

# 3. Start PostgreSQL locally
docker compose up -d

# 4. Apply the database schema
npx prisma migrate dev --name init

# 5. Start the API in watch mode
npm run start:dev
```

The API listens on `http://localhost:3000` by default, under the global
prefix `/api/v1`. In development, Swagger UI is available at
`http://localhost:3000/api/docs`.

### A note on the bed allocation constraint

Prisma's schema DSL cannot express a *partial* unique index (`UNIQUE ...
WHERE status = 'ACTIVE'`), which is what actually guarantees - at the
database level, immune to race conditions - that a bed can have at most
one active occupant and a tenant at most one active allocation. After
running the first migration, create a follow-up migration to add it by
hand:

```bash
npx prisma migrate dev --name bed_allocation_active_constraints --create-only
```

Then add this to the generated `migration.sql` before applying it:

```sql
CREATE UNIQUE INDEX "bed_allocations_active_bed_unique"
  ON "bed_allocations" ("bed_id")
  WHERE "status" = 'ACTIVE';

CREATE UNIQUE INDEX "bed_allocations_active_tenant_unique"
  ON "bed_allocations" ("tenant_id")
  WHERE "status" = 'ACTIVE';
```

```bash
npx prisma migrate dev
```

This is deferred rather than baked into Phase 0's migration because the
allocation service that relies on it (check-in/checkout/transfer) is
built in Phase 4 - the schema comment documents the requirement now so it
isn't forgotten later.

## Running locally - learning notes

If you're setting this up for the first time (or teaching yourself the
"why" behind each step instead of just copy-pasting commands), see
[LEARNING.md](LEARNING.md). It walks through an actual first-run session
end to end: the prompts used, the issues hit along the way (a missing
Docker install, a UAC elevation snag, Postgres rejecting a `pg_`-prefixed
role name), the root cause of each, and a no-AI checklist to redo the
whole flow yourself.

## Common commands

| Command | Purpose |
| --- | --- |
| `npm run start:dev` | Run the API with hot reload |
| `npm run build` | Compile TypeScript to `dist/` |
| `npm run start:prod` | Run the compiled app (`dist/main.js`) |
| `npm run lint` | ESLint (auto-fix) |
| `npm run format` | Prettier write |
| `npm test` | Unit tests |
| `npm run test:e2e` | End-to-end tests (HTTP layer, DB mocked) |
| `npm run test:cov` | Unit tests with coverage |
| `npx prisma studio` | Browse the database visually |
| `npx prisma migrate dev` | Create/apply a migration in development |
| `npx prisma migrate deploy` | Apply pending migrations (CI/production) |
| `npx prisma generate` | Regenerate the Prisma client after a schema change |
| `docker compose up -d` | Start local PostgreSQL |
| `docker compose down` | Stop local PostgreSQL (add `-v` to also wipe data) |

## Health check

```
GET /api/v1/health
```

Returns Terminus's standard health payload and pings the database.
Responds `200` when healthy, `503` when the database is unreachable.

## Architecture

```
src/
├── app.module.ts          # Root module: config, guards, filters, pipes wiring
├── main.ts                # Bootstrap: security middleware, Swagger, prefix
├── common/                 # Cross-cutting, framework-level concerns
│   ├── constants/           # ErrorCode enum (machine-readable error codes)
│   ├── decorators/           # @RawResponse() - opt out of the success envelope
│   ├── exceptions/           # AppException - the only exception app code should throw
│   ├── filters/               # AllExceptionsFilter - single source of error responses
│   ├── interceptors/           # ResponseInterceptor - wraps success responses
│   ├── logger/                  # JsonLoggerService - structured console logging
│   └── middleware/              # RequestIdMiddleware - per-request tracing ID
├── config/                 # Environment loading + Joi validation (fail fast on boot)
├── database/               # PrismaService/PrismaModule - the only way to reach Postgres
├── health/                 # GET /api/v1/health
└── modules/
    ├── users/               # UsersService - the only code that reads/writes the `users` table
    ├── auth/                # Login/register/refresh/logout, JWT strategy/guard, token + password services
    ├── identity-verification/  # KYC domain foundation (no HTTP endpoints yet)
    ├── memberships/          # MembershipsService - the single authorization chokepoint (Phase 2)
    ├── organizations/        # Organization CRUD, OrganizationMembershipGuard, MembershipRoleGuard
    ├── properties/           # Property CRUD, scoped entirely through MembershipsService
    ├── rooms/                # Room CRUD, scoped through PropertiesService.getAccessiblePropertyOrThrow
    ├── beds/                 # Bed CRUD, scoped through RoomsService.getAccessibleRoomOrThrow
    ├── tenants/              # Minimal User<->Tenant profile (see "Phase 4" below)
    ├── residencies/          # Residency CRUD + check-in/check-out (BedAllocation lifecycle)
    ├── rent-plans/           # RentPlan CRUD, scoped through ResidenciesService.getAccessibleResidencyOrThrow
    ├── invoices/             # Invoice generation/lifecycle - the only Invoice/InvoiceItem creation path
    └── payments/             # Tenant payment orders/verification/webhook, platform fee, owner settlement
        └── gateway/            # PaymentGateway interface + RazorpayGatewayService (Razorpay is isolated here)
```

`complaints, food, announcements, notifications, subscriptions` (the
owner's own SaaS subscription, not tenant rent payments) do not exist as
modules yet - they are added incrementally, one module per phase.
Creating empty module shells ahead of the code that belongs in them would
just be structure for its own sake.

### Key decisions and why

- **Modular monolith, not microservices.** One deployable, one database,
  clear module boundaries. Nothing about this product's current scale
  justifies the operational cost of microservices; the module boundaries
  are what would make a future extraction possible if it's ever needed.
- **Multi-tenancy via membership, not a role column on User.** A `User`
  is an identity. `OrganizationMembership` is the only place a role is
  recorded, scoped to one `Organization`. This is what lets one person be
  `OWNER` of one PG business and `STAFF` in another, and is the seam every
  future authorization guard hangs off.
- **One authorization chokepoint (`MembershipsService`), not scattered
  role checks.** Every organization/property permission decision -
  guards and services alike - calls `assertOrganizationAccess`/`assertRole`
  on this one service. See "Phase 2: multi-tenant authorization
  architecture" below for the full request flow and why cross-tenant
  access always returns 404, never 403.
- **Each layer of the ownership chain reuses the layer above it, rather
  than re-deriving authorization from scratch.** `RoomsService` calls
  `PropertiesService.getAccessiblePropertyOrThrow()`; `BedsService` calls
  `RoomsService.getAccessibleRoomOrThrow()`; `RentPlansService` and
  `InvoicesService` (Phase 5) both call
  `ResidenciesService.getAccessibleResidencyOrThrow()`. Six phases deep,
  and every one of them still funnels through the same
  `MembershipsService` chokepoint from Phase 2 - adding a new layer has
  only ever meant one new public method on the layer above it, never a
  change to how organization access itself is decided. **Phase 6 is the
  one deliberate exception**: `PaymentsService` does *not* reuse
  `InvoicesService`'s own lookup, because that lookup is scoped only to
  organization membership - a tenant paying their own rent is not an
  organization member at all. See "Phase 6" below for the new,
  narrower-scoped authorization path this required.
- **Money is never a JS number.** Every monetary column is
  `Decimal @db.Decimal(12, 2)`, every calculation uses `Prisma.Decimal`
  arithmetic, and every API response serializes amounts as decimal
  strings (`"8000.00"`, never `8000`) - see "Phase 5: rent & invoices"
  below for the full reasoning and the one rounding rule
  (`ROUND_HALF_UP`) used everywhere.
- **A concurrency invariant that spans multiple rows needs a lock, not a
  unique index.** Phase 4/5's partial/plain unique indexes solve "at most
  one row may look like this" - Phase 6's "the sum of a payment's
  allocations may never exceed an invoice's total" is a constraint over
  *many* rows, which Postgres cannot express as a uniqueness constraint.
  `PaymentsService.finalizeCapturedPayment` uses a transaction-scoped
  `SELECT ... FOR UPDATE` on the invoice row instead - see "Phase 6"
  below, including a real bug this distinction caught: Prisma's P2002
  `target` for a plain schema-declared `@@unique` comes back as the
  *column names*, not the constraint's given name, against real
  Postgres - a mismatch a mocked unit test alone would never surface.
- **Bed allocation is an append-only history, not a `currentBedId`
  pointer.** `BedAllocation` rows are never overwritten; ending a stay
  sets `endDate`/`status`, it never deletes the row. The "two tenants, one
  bed" race condition is closed by a partial unique index at the database
  layer (see above), not by application-level locking, because
  application-level checks alone cannot survive concurrent requests.
- **One exception type for app code (`AppException`), one filter
  (`AllExceptionsFilter`).** Every error - validation, business rule,
  Prisma constraint violation, unexpected bug - is funneled through the
  same filter and comes out as `{ success: false, error: { code, message
  }, requestId }`. No controller formats its own error response, and no
  client has to guess the shape of an error from a new endpoint.
- **`ResponseInterceptor` wraps every success response** in `{ success:
  true, data, requestId }` for the same reason. `@RawResponse()` is the
  documented escape hatch for the one case where a contract is dictated by
  someone else (the health endpoint's Terminus payload).
- **Structured JSON logging via a ~40-line custom `LoggerService`**, not
  pino/winston. Nest 10's built-in `ConsoleLogger` doesn't support a JSON
  output mode; pulling in a full logging library for one JSON-lines
  formatter would be more dependency than the problem warrants. Swap it
  later if log volume or a specific transport (shipping to Datadog/Loki)
  demands it - nothing outside this one file would need to change.
- **Custom Prisma health indicator instead of the one bundled with
  `@nestjs/terminus`.** The bundled indicator is written for both Mongo
  and SQL clients and only falls back to a SQL ping after a Mongo ping
  fails in a very specific way. This project is Postgres-only; a direct
  `SELECT 1` is simpler, more obviously correct, and easier to unit test.
- **Global `ValidationPipe` with `whitelist` + `forbidNonWhitelisted`.**
  Unknown fields in a request body are rejected (400), not silently
  dropped - the frontend is never trusted, per the project's security
  requirements, and a silently-ignored field is a worse failure mode than
  a loud one.
- **`RequestIdMiddleware` runs before everything else** and honours an
  inbound `X-Request-Id` header when present (from a gateway or another
  service), generating one otherwise. It's threaded through both the
  success envelope and the error envelope for end-to-end tracing.
- **Env validated with Joi at startup (`config/env.validation.ts`).** A
  missing `JWT_ACCESS_SECRET` fails the app at boot with a clear message,
  not on the first request that happens to need it.
- **Strict TypeScript.** The Nest CLI scaffold ships with
  `strictNullChecks`/`noImplicitAny` turned *off* by default; this
  project turns strict mode fully on, since a PG/rent/payments domain has
  enough real nullability (optional email, nullable `endDate`, ...) that
  loose null checking would hide real bugs.

## Data model (Phase 0 through Phase 6)

```
Organization (status: ACTIVE | INACTIVE | SUSPENDED)
├── OrganizationMembership (user + role: OWNER | MANAGER | STAFF | STUDENT)
│                          (status: ACTIVE | SUSPENDED | REMOVED)
├── OwnerPaymentAccount (one per organization; provider account/onboarding status)
├── Payment[] / OwnerSettlement[] (denormalized organizationId - see below)
└── Property (status: ACTIVE | INACTIVE | ARCHIVED; propertyType: PG | HOSTEL | ...)
    ├── Room (roomNumber, floor, roomType, capacity; status: ACTIVE | INACTIVE | ARCHIVED)
    │   └── Bed (bedNumber; status: AVAILABLE | INACTIVE | ARCHIVED)
    └── Residency (tenant + startDate/expectedEndDate/actualEndDate;
                    status: PENDING | ACTIVE | NOTICE_PERIOD | CHECKED_OUT)
        ├── BedAllocation (history: bed + start/end; status: ACTIVE | ENDED | CANCELLED)
        ├── RentPlan (amount, dueDay, effectiveFrom/effectiveTo; status: ACTIVE | INACTIVE)
        └── Invoice (billing period, subtotal/discount/tax/total, invoiceNumber;
                      status: DRAFT | ISSUED | OVERDUE | PARTIALLY_PAID | PAID | VOID)
            ├── InvoiceItem (description, quantity, unitAmount, amount; itemType: RENT)
            └── Payment[] (via PaymentAllocation - see "Phase 6" below)
                ├── PaymentAllocation (how much of a payment counts toward this invoice)
                ├── OwnerSettlement (1:1 - the owner's share of a CAPTURED payment)
                └── Refund[] (against a CAPTURED payment)

PlatformFeeRule (global, not per-organization - see "Phase 6" below)
WebhookEvent (provider + eventId, globally unique - Razorpay delivery log)

User ──< OrganizationMembership >── Organization
User ──(1:1)── Tenant ──< Residency
User ──< Payment                 (Phase 6: payerUserId - always the tenant)
User ──< RefreshToken            (Phase 1: one row per active session/device)
User ──< IdentityVerification    (Phase 1: KYC foundation)
```

- `User` is pure identity (phone/email/name/password hash). It has no
  role field and no organization/property/room/bed field - see "Key
  decisions" above and the Phase 1/Phase 2 architecture sections below.
- `Tenant` is a thin, global, 1:1 marker on top of `User`
  (`id`/`userId`/timestamps only) - not a second identity, and not
  scoped to an organization. See "Phase 4: tenants, residency & bed
  allocation" below for why Phase 0's original organization-scoped
  Tenant shape (name/phone/email/status) was replaced rather than kept.
- `RefreshToken.tokenHash` is a SHA-256 hash - the raw refresh token is
  never persisted. `revokedAt`/`lastUsedAt` support rotation, reuse
  detection, and multi-device sessions (see below).
- `IdentityVerification` is its own table, deliberately never a boolean on
  `User`/`Tenant` - see "KYC / identity verification foundation" below.
- `Organization.status` (`ACTIVE | INACTIVE | SUSPENDED`) is a distinct
  enum from `Property.status` (`ACTIVE | INACTIVE | ARCHIVED`) even though
  the names overlap - organization suspension is a platform-level
  moderation action affecting everything underneath it; property archival
  is an owner's own lifecycle decision. Conflating them would make one
  feature accidentally mean something different for the other.
- `OrganizationMembership.status` is `ACTIVE | SUSPENDED | REMOVED` -
  deliberately no `INVITED` yet, since Phase 2 does not implement the
  invitation flow (see "Membership invitation - deferred" below).
  `@@unique([userId, organizationId])` is enforced by Postgres, not just
  application code, so two concurrent "create organization" calls for the
  same user can never race into duplicate membership rows.
- `Property.propertyType` (`PG | HOSTEL | CO_LIVING | STUDENT_HOUSING`) is
  provider-neutral on purpose - "PG" is the UI's word for this, not the
  domain's. `Property` itself is never renamed or table-mapped to "PG".
- `Room.roomNumber`/`Bed.bedNumber` are strings, not integers - real
  numbering ("A-101", "DORM-1", "G01") is never purely numeric. Each is
  unique only within its parent (`@@unique([propertyId, roomNumber])`,
  `@@unique([roomId, bedNumber])`), never globally - see "Phase 3:
  property structure" below.
- `Room.capacity` has no CHECK constraint tying it to `Bed` rows -
  Postgres cannot express "count of a different table's rows" in a column
  constraint. It is enforced in `RoomsService`/`BedsService` via a locked
  read-count-then-write transaction instead (see below).
- `RoomStatus`/`BedStatus` both end in `ARCHIVED` - the soft-delete state
  every DELETE endpoint in this codebase uses instead of a real SQL
  `DELETE`, applied consistently from `Property` down through `Bed`.
- `Residency` sits between `Tenant` and `Property` - "who is/was staying
  where, when" - and is deliberately separate from `BedAllocation` -
  "which specific bed, during that stay." A `Residency` never has a
  `bedId` column; see "Phase 4" below for exactly why and what that
  enables (bed transfers without losing history).
- `BedAllocation.status` is `ACTIVE | ENDED | CANCELLED`, and its foreign
  key is `residencyId`, not `tenantId` (Phase 0's original scaffold linked
  allocations directly to a tenant - replaced once `Residency` existed to
  sit between them). Concurrency safety for "one bed, one active
  allocation" *and* "one tenant, one active residency" is enforced by two
  partial unique indexes (see "Phase 4" below), not by application code
  alone.
- `PrismaClientKnownRequestError` (Prisma's own error type, e.g. a unique
  constraint violation) is mapped to the standard error envelope
  automatically by `AllExceptionsFilter` - a future module doesn't need
  its own try/catch for that (this is what Phase 1's duplicate
  email/phone handling, Phase 2's duplicate-membership constraint, Phase
  3's duplicate room/bed number constraints, and Phase 4's duplicate
  active-residency/active-allocation constraints all rely on).
- `RentPlan` and `Invoice`/`InvoiceItem` monetary columns are all
  `Decimal @db.Decimal(12, 2)`, never `Float`/`Int` - see "Money is never
  a JS number" above and "Phase 5" below.
- `RentPlan.effectiveFrom`/`effectiveTo` model history the same way
  `BedAllocation` does: creating a new plan closes out the previous one
  (`status: INACTIVE`, `effectiveTo` set) rather than overwriting it, so
  past invoices always remain attributable to the plan that was active
  when they were generated.
- `Invoice.rentPlanId` is a nullable, `onDelete: SetNull` foreign key kept
  purely for audit/traceability ("which plan produced this invoice") - it
  is never read back to reconstruct or recompute a historical total.
  `Invoice`/`InvoiceItem` are snapshots: `subtotal`/`discount`/`tax`/
  `total` and each item's `unitAmount`/`amount` are persisted at
  generation time and never recalculated from the current `RentPlan`, so
  a later rent change cannot silently alter an already-issued invoice.
- Two Phase 5 uniqueness invariants are both enforced by Postgres, not
  application code alone: `invoices_residency_billing_period_unique`
  (`@@unique([residencyId, billingPeriodStart, billingPeriodEnd])`, a
  plain Prisma-expressible constraint - one invoice per residency per
  billing period) and `rent_plans_active_residency_unique` (a
  hand-written partial unique index, `WHERE status = 'ACTIVE'`, since
  Prisma's schema DSL cannot express a `WHERE` clause on a unique index -
  one active rent plan per residency, same pattern as Phase 4's
  `residencies_active_tenant_unique`/`bed_allocations_active_bed_unique`).
- `Invoice.invoiceNumber` is generated from a Postgres sequence
  (`invoice_number_seq` via `nextval()`), never `COUNT(*) + 1` - see
  "Phase 5" below for why that matters under concurrent invoice
  generation.
- `Payment`, `PaymentAllocation`, `PlatformFeeRule`, `OwnerPaymentAccount`,
  `OwnerSettlement`, and `Refund` monetary columns are all
  `Decimal @db.Decimal(12, 2)`, same as every Phase 5 column - see "Money
  is never a JS number" above.
- `Payment.organizationId`/`propertyId`/`residencyId` are denormalized
  from the invoice at creation time rather than always joined through it -
  spec section 23/24's multi-PG requirement (one owner, many PGs, many
  residents) means a payment must never be queryable into the wrong PG,
  and an explicit column makes that scoping impossible to get wrong in a
  query, not just conventionally correct.
- `Payment` and `OwnerSettlement` are deliberately separate rows, not one
  table with extra columns - spec section 36: "the tenant paid" and "the
  owner was paid out" are different facts with different lifecycles (a
  `Payment` can be `CAPTURED` while its `OwnerSettlement` is still
  `PENDING`, and a settlement can independently `FAIL` without that ever
  touching the tenant-facing payment status). See "Phase 6" below.
- `PaymentAllocation` is its own table, never a running-total column on
  `Invoice` - an invoice's outstanding balance is always
  `Invoice.total - SUM(PaymentAllocation.amount for CAPTURED payments)`,
  computed the same way on every read rather than kept in sync by hand
  (see "Phase 6" below for why a refund updates an allocation's amount
  rather than deleting the row).
- `@@unique([paymentId, invoiceId], name: "payment_allocations_payment_invoice_unique")`
  prevents a payment from ever being allocated twice to the same invoice -
  relevant because webhook delivery is retried and must never double-count
  a payment it already finalized.
- `WebhookEvent` has `@@unique([provider, eventId], name: "webhook_events_provider_event_unique")` -
  the actual idempotency guarantee for Razorpay webhook processing (spec
  sections 31-33), not just an audit log. See "Phase 6" below for a real
  bug this constraint's own error-matching code had until it was tested
  against genuine concurrent delivery on real Postgres.
- `OwnerPaymentAccount.organizationId` is `@unique` - one settlement
  account per organization, covering every property underneath it (spec
  section 24's stated Phase 6 default), not one account per property.
- `PlatformFeeRule` has no `organizationId` at all - it's a single global,
  versioned business rule (`isActive`), not a per-organization setting -
  see "Phase 6" below.

## Roles

Five roles are modeled from day one: `SUPER_ADMIN` (platform-level, on
`User.platformRole`), and `OWNER | MANAGER | STAFF | STUDENT`
(organization-scoped, on `OrganizationMembership.role`). As of Phase 2,
`OWNER`/`MANAGER`/`STAFF` are enforced by `MembershipsService` +
`MembershipRoleGuard`/`PropertiesService` (see below); `STUDENT` is not
granted through any Phase 2 endpoint - it exists in the enum for a future
residency-driven flow, never assigned automatically just because someone
stays at a PG.

## Testing strategy

- `src/**/*.spec.ts` - unit tests, run with `npm test`. Covers
  `AllExceptionsFilter` (Phase 0's highest-leverage error-handling logic);
  from Phase 1: `AuthService` (login/register/refresh
  rotation/reuse-detection/logout, all edge cases from the spec),
  `TokenService` (payload minimality, secret isolation between access and
  refresh tokens, hash determinism), `IdentityVerificationService` (every
  valid and invalid state transition), and the email/phone normalization
  helpers; from Phase 2: `MembershipsService` (every branch of
  `assertOrganizationAccess`/`assertRole`, including the SUPER_ADMIN
  bypass and organization suspension), `OrganizationsService` (atomic
  create, membership-scoped listing), and `PropertiesService` (the full
  BOLA/IDOR-safe lookup, and the OWNER/MANAGER/STAFF permission matrix);
  from Phase 3: `RoomsService` (property-active gating, the capacity-safe
  update transaction, BOLA-safe room lookup) and `BedsService` (the
  full property→room→bed active-status chain, the capacity-safe bed
  creation transaction, archived beds excluded from the capacity count,
  BOLA-safe bed lookup on a mismatched room/property); from Phase 4:
  `TenantsService` (self-only creation, the three-way visibility rule on
  `findOne`), and `ResidenciesService` (every precondition on check-in -
  wrong state, mismatched bed/property, an archived/inactive
  property/room/bed, an already-occupied bed; check-out state rules
  including double-checkout; and, critically, both partial-unique-index
  violations - `bed_allocations_active_bed_unique` and
  `residencies_active_tenant_unique` - each asserted to translate into the
  correct domain error rather than leak a raw database error).
- `test/*.e2e-spec.ts` - HTTP-level tests, run with `npm run test:e2e`.
  `PrismaService` is overridden with an in-memory fake in every e2e test
  so the suite does not require a running database; `auth.e2e-spec.ts`
  exercises the full register → login → `/me` → refresh-rotation →
  reuse-detection → logout flow;
  `phase2-organizations-properties.e2e-spec.ts` exercises organization
  creation, property creation/read/update/archive, and an "outsider"
  account being rejected (404) on every one of an org's resources; and
  `phase3-rooms-beds.e2e-spec.ts` exercises room/bed CRUD, duplicate room
  /bed number rejection (and that the same number is fine in a different
  property/room), capacity enforcement (including that archiving a bed
  frees its capacity slot), rejecting creation in an archived
  property/room, and - the most safety-critical cases - a second real
  "Organization B" owner being rejected (404) on every one of Organization
  A's rooms/beds: reading, updating, archiving, creating via a spoofed
  `propertyId`, and creating a bed by combining Room A's id with Property
  B's id in the URL (the mismatched-chain attack from spec section 8); and
  `phase4-tenants-residency.e2e-spec.ts` exercises tenant self-creation
  and duplicate rejection, residency creation/validation (including
  rejecting a second active/pending residency for the same tenant), the
  full check-in → check-out lifecycle against a real HTTP stack (rejecting
  a bed from a different property, rejecting double check-in, rejecting a
  second resident into an already-occupied bed, double-checkout, and
  confirming a bed is free again after checkout), and cross-organization
  rejection of every residency action for an unrelated "Organization B"
  owner.
- Duplicate-membership enforcement (`@@unique([userId, organizationId])`)
  is verified at the database/migration level (confirmed during manual
  verification) rather than through an HTTP test, because Phase 2 has no
  invite/join endpoint that could ever attempt to create a second
  membership row for the same user+organization - a test exercising an
  endpoint that doesn't exist would test nothing real.
- The mandatory "two concurrent check-ins race for the same bed"
  requirement (spec section 33) is proven against the **real** running
  Postgres instance, not the in-memory e2e fakes - a true race between
  two overlapping requests cannot be demonstrated against a
  single-threaded in-memory stand-in. `residencies.service.spec.ts`
  unit-tests the *translation* logic (a caught P2002 becomes
  `BED_ALREADY_OCCUPIED`/`TENANT_ALREADY_ALLOCATED`, not a raw database
  error); the *actual* race - firing two simultaneous check-in requests at
  the same bed with `Promise.all` against the live server - was run
  manually and confirmed exactly one succeeded, with exactly one `ACTIVE`
  row left in `bed_allocations` afterward (see the Phase 4 final report's
  manual verification section for the full transcript).
- From Phase 5: `proration.util.spec.ts` (full-period stays return the
  exact monthly amount with no rounding drift, mid-month start/checkout
  proration against the documented formula, inclusive day counting across
  28/29/30/31-day months, and the zero-overlap edge case),
  `billing-period.util.spec.ts` (calendar-month boundaries and due-date
  clamping when `dueDay` exceeds the month's last day), `rent-plans
  .service.spec.ts` (first-plan creation, rejecting a zero/negative amount
  and a non-increasing `effectiveFrom`, closing out the previous ACTIVE
  plan on a new one, translating a concurrent-creation unique violation
  into `INVALID_RENT_PLAN`, role enforcement, and BOLA-safe lookup), and
  `invoices.service.spec.ts` (billing calculation, the DRAFT/ISSUED/
  OVERDUE/VOID lifecycle and its illegal transitions, duplicate-period
  rejection, and BOLA-safe lookup). `test/phase5-rent-invoices.e2e-spec.ts`
  exercises the full rent-plan lifecycle, invoice generation/calculation/
  issue/void/re-issue-rejection over HTTP, mid-month proration (including
  rejecting generation for a period before the residency started), and
  cross-organization rejection of every rent-plan/invoice action for an
  unrelated "Organization B" owner.
- The mandatory "two concurrent invoice-generation requests race for the
  same residency + billing period" requirement is, like Phase 4's
  check-in race, proven against the **real** running Postgres instance,
  not the in-memory e2e fakes: firing two simultaneous
  `POST /residencies/:id/invoices` requests for the same year/month with
  `Promise.all` against the live server was run manually and confirmed
  exactly one succeeded (`201`), the other received `409
  DUPLICATE_BILLING_PERIOD`, with exactly one row left in `invoices` for
  that billing period and no duplicate `invoiceNumber` values anywhere in
  the table.
- From Phase 6: `money.util.spec.ts` (exact Decimal-to-paise conversion,
  including a value that misrounds under naive float multiplication),
  `platform-fee.service.spec.ts` (the active FIXED rule, the fee never
  exceeding a small gross amount, no active rule defaulting to zero),
  `razorpay-gateway.service.spec.ts` (the actual HMAC-SHA256 formulas for
  both payment-signature and webhook-signature verification, run against
  real `crypto`, not a mock - a tampered body or wrong secret is rejected,
  a genuinely correctly-signed payload is accepted), `payments.service
  .spec.ts` (order creation and its BOLA/outstanding-balance/idempotency-
  key branches, `finalizeCapturedPayment`'s PAID/PARTIALLY_PAID branching
  and its overpayment-rejection branch, `verifyPayment`'s signature/BOLA
  checks, and `refund`'s role/state checks), and
  `payments-webhook.service.spec.ts` (signature verification gating
  everything else, `payment.captured`/`payment.failed` handling, the
  (provider, eventId) duplicate-delivery no-op, and safely ignoring an
  event with no matching internal payment). `test
  /phase6-tenant-payments.e2e-spec.ts` exercises the full order → verify →
  allocation → platform-fee → settlement flow over HTTP (with a
  deterministic in-memory fake standing in for the real Razorpay SDK - the
  real HMAC math is what `razorpay-gateway.service.spec.ts` proves),
  partial payments accumulating to `PAID`, the refund foundation
  (including an invoice stepping back down from `PAID`), Razorpay webhook
  idempotency, and cross-tenant/cross-organization rejection of every
  payment action for an unrelated user.
- The mandatory "two concurrent payments consume the same outstanding
  balance" and "duplicate webhook delivery" requirements (spec section 44)
  were proven against the **real** running Postgres instance with a
  one-off script exercising `PaymentsService.finalizeCapturedPayment`/
  `PaymentsWebhookService.processRazorpayWebhook` directly (bypassing the
  real Razorpay API, for which this environment has no live test
  credentials - the concurrency guarantee being proven lives entirely in
  the database transaction, not in Razorpay's own behavior). Two
  simultaneous ₹5,000 payments against a single ₹5,000 invoice balance
  resolved to exactly one `CAPTURED` and one `FAILED
  (OVERPAYMENT_REJECTED)`, with exactly one `PaymentAllocation` row and
  the invoice at `PAID`; two simultaneous deliveries of the same webhook
  event resolved to exactly one `PaymentAllocation`, one `OwnerSettlement`,
  and one `WebhookEvent` row. This same run caught and fixed a real bug
  (see "Phase 6" below): Prisma's `P2002` `target` for a plain
  schema-declared `@@unique` came back as the column-name array against
  real Postgres, not the constraint's given name, which had silently
  broken both `WebhookEvent`'s and (retroactively discovered) Phase 5's
  `Invoice`'s duplicate-conflict error-code translation - the raw,
  untranslated error was still being mapped to a generic `409 CONFLICT`
  by `AllExceptionsFilter`'s catch-all Prisma handling, which is exactly
  why a plausible-looking `409` response masked the wrong error *code*
  (`CONFLICT` instead of the documented `DUPLICATE_BILLING_PERIOD`) until
  this exact check was run against a real database instead of a mock.
  Both call sites now match on the column-name array as well as the
  declared constraint name (see `PaymentsWebhookService`/`InvoicesService`
  `isUniqueViolation`).

## Environment variables

See `.env.example` for the full list. All of them are validated at
startup (`src/config/env.validation.ts`); the app refuses to boot if a
required one is missing or malformed.

## Phase 1: authentication & identity architecture

### The core principle: a person is a platform user, not a PG

A `User` is a global identity. It is never tied to a specific PG, property,
room, or bed - there is no `propertyId`/`roomId`/`bedId` on `User`, and
there never will be. Where someone currently lives is a fact recorded by
the *residency* domain (Phase 4+), which a user can enter and leave
repeatedly over time without ever getting a new account:

```
User (U1001, "Rahul")
  ↓
Identity Verification   - "has this person's identity been verified?"
  ↓
PG Application          - "has this person applied to stay at this PG?"
  ↓
Residency               - "is this person currently staying at this PG?"
```

Each stage in that diagram is a **separate concept with its own record**.
Being authenticated does not mean verified; being verified does not mean
a tenant anywhere; applying does not mean accepted; a visit does not mean
either. Only a future check-in workflow (Phase 4) creates a `Residency`/
`BedAllocation` row, and that is the *only* thing that means "this person
currently lives here." A user can hold an `ACTIVE` allocation at PG A,
check out, and later apply to and check in at PG B - same `User.id`
throughout, a brand new residency record each time.

### Authentication architecture

- **Password auth today, OTP-ready by design.** `User.passwordHash` is
  nullable specifically so a future OTP-only user (identity proven by a
  phone code, never a password) can exist without a schema change or a
  parallel user table. `AuthService.login` already refuses to authenticate
  a user with no password hash (rather than crashing on `argon2.verify`),
  which is exactly the branch a future OTP flow slots in next to.
- **Argon2id** (`PasswordService`) hashes passwords; the hash is never
  returned by any endpoint, logged, or placed in a JWT.
- **Account enumeration is avoided on purpose.** A nonexistent account, a
  user with no password set, and a wrong password all produce the exact
  same `401 INVALID_CREDENTIALS` response. Account *status* (suspended/
  inactive) is only revealed **after** the password has already been
  confirmed correct - by that point the caller has already proven they
  hold the credential, so it is no longer an oracle for guessing whether
  an account exists.
- **`JwtAuthGuard`** (`@UseGuards(JwtAuthGuard)`) protects routes;
  **`@CurrentUser()`** reads the safe, database-fresh user object it
  attaches to the request - never the raw JWT payload.

### Access token lifecycle

- Payload is **`{ sub: userId }` only** - no password, role, KYC status,
  room/bed/property data, or other sensitive profile fields ever go in a
  JWT. Anything else a protected route needs is loaded fresh from the
  database.
- Short-lived (`JWT_ACCESS_EXPIRES_IN`, default `15m`), signed with
  `JWT_ACCESS_SECRET`.
- **`JwtStrategy.validate()` re-reads the user from the database on every
  request** and rejects if the user is missing or not `ACTIVE`. This is
  what makes "account suspended after a token was already issued" take
  effect within one access-token lifetime instead of waiting for the much
  longer-lived refresh token to expire.

### Refresh token lifecycle & rotation

- One `RefreshToken` row per issued refresh token = one row per active
  login session/device. Only a **SHA-256 hash** of the token is ever
  stored (`TokenService.hashToken`) - a database leak alone cannot be used
  to forge a session.
- **Rotation, not reuse:** every call to `POST /auth/refresh` revokes the
  presented row and creates a brand-new one in the same database
  transaction (`AuthService.rotateRefreshToken`). A row is never flipped
  back to "unrevoked."
- **Reuse detection:** presenting a refresh token whose row is already
  `revokedAt != null` is treated as token theft, not a normal error. The
  handler revokes **every other active session for that user** and
  returns `TOKEN_REVOKED` - the affected user is forced to re-authenticate
  on every device, which is the safe default when a stolen refresh token
  is suspected. There is no explicit "token family" column; grouping by
  `userId` is the simpler, equally effective mechanism given nothing else
  in Phase 1 needs a finer-grained family concept.
- **Concurrent refresh requests** for the same token are handled by a
  compare-and-swap: the revoke step is a conditional `updateMany` that
  only succeeds for rows still `revokedAt: null`. At most one concurrent
  request can win; the other sees `count === 0` and gets the same
  `TOKEN_REVOKED` response a reused token would produce (from its point of
  view, it cannot tell the difference, so it isn't told a different lie).

### Multi-device sessions

Each login/register call creates one independent `RefreshToken` row.
Logging out (`POST /auth/logout`) revokes only the **one** row matching
the presented token - other devices' sessions are untouched. A future
"log out everywhere" endpoint is a one-line addition
(`prisma.refreshToken.updateMany({ where: { userId, revokedAt: null } })`,
already used internally for reuse detection) and needs no schema change.

### KYC / identity verification foundation

`IdentityVerification` is a **separate table**, never a boolean on `User`
or `Tenant`. Fields are provider-agnostic (`provider`, `providerReference`)
so a real KYC vendor integration (DigiLocker, an Aadhaar-eKYC provider,
...) can be added later without a schema change - and so this repository
never stores a raw government ID number or document image. Status is a
state machine (`NOT_STARTED → PENDING → VERIFIED/FAILED → ...`), enforced
in `IdentityVerificationService`/`identity-verification.transitions.ts`,
not by a database CHECK constraint (transition policy is product policy,
and will evolve).

`IdentityVerificationService.start()` **reuses a still-valid `VERIFIED`
record** for the same user + verification type instead of creating a
duplicate - this is what lets a user who moves from PG A to PG B skip
re-verification by default. A specific PG that requires additional/fresh
verification calls `start(userId, type, { force: true })` explicitly; that
policy decision belongs to the PG-application domain in a later phase, not
to this foundation.

No HTTP endpoints are wired up for this domain yet - nothing in Phase 1
triggers a real verification (that arrives with the PG-application flow).
What Phase 1 establishes is the *shape* of the domain so later phases
attach to it instead of retrofitting KYC state onto `User` or `Tenant`.

### Roles stay out of `User` and out of authentication

`SUPER_ADMIN` (platform-level, `User.platformRole`) is the only role
meaningful without an organization. `OWNER`/`MANAGER`/`STAFF`/`STUDENT` are
**not** columns on `User` - they are recorded on
`OrganizationMembership.role`, scoped to one organization. Two different
users can hold different roles in the same organization, and the same
user can hold different roles in different organizations. Auth
(`AuthService`/`JwtAuthGuard`) only ever answers "who is this user" -
"what can this user do" is what Phase 2 (below) answers.

## Phase 2: multi-tenant authorization architecture

### User → OrganizationMembership → Organization → Property

```
User
  │
  ▼
OrganizationMembership (role: OWNER | MANAGER | STAFF, per organization)
  │
  ▼
Organization
  │
  ▼
Property ("PG" in the UI - see "Why not call the table PG" below)
```

A `User` never belongs to an organization directly - the membership row is
the only thing that grants access, and it can be revoked (`status:
REMOVED`) without touching the `User` row at all. The same `User` can hold
an `OrganizationMembership` in any number of organizations, with a
different role in each:

```
Rahul (User u1)
  ├── OrganizationMembership → "ABC Living"  → role: OWNER
  └── OrganizationMembership → "XYZ Co-living" → role: MANAGER
```

This is the same principle Phase 1 established for residency, one level
up: a `User` is never permanently tied to one `Organization`, exactly as a
`User` is never permanently tied to one PG. The future PG-application /
residency chain (Phase 4+) hangs off `User` and `Property` independently:

```
User
  │
  ▼
Future PGApplication  ("has this person applied to stay here?")
  │
  ▼
Future Residency      ("is this person currently staying here?")
  │
  ▼
Property
```

`OrganizationMembership` (staff/ownership) and the future `Residency`
(a student physically living somewhere) are unrelated axes - an `OWNER`
does not thereby become a resident, and a resident does not thereby
become an `OrganizationMembership` row. Conflating them was exactly the
Phase 1 mistake this architecture avoids twice over.

### Owner onboarding

```
Authenticated User
  │
  ▼
POST /organizations  { name }
  │
  ▼  (single DB transaction)
  ├── Organization created
  └── OrganizationMembership created (role: OWNER, status: ACTIVE)
```

There is no other way to become an `OWNER` of a *new* organization, and no
input field lets a client request `SUPER_ADMIN` or attach themselves as
`OWNER` of an *existing* organization - `CreateOrganizationDto` has
exactly one field (`name`). Becoming `OWNER` of someone else's existing
organization, or `MANAGER`/`STAFF` of any organization, requires a future
invitation flow (deferred - see below); Phase 2 has no endpoint that
grants a membership in an organization the caller didn't just create.

The transaction matters: if the membership insert ever failed after the
organization insert succeeded, the whole call rolls back rather than
leaving an organization with no owner (verified in
`organizations.service.spec.ts`).

### The request flow every organization/property endpoint follows

```
Request
  │
  ▼
JwtAuthGuard          - who is making this request? (Phase 1)
  │
  ▼
MembershipsService     - does this user have ANY access to this organization?
  .assertOrganizationAccess()   (404 if not - existence hidden either way)
  │
  ▼
MembershipsService     - does their role allow THIS action?
  .assertRole()                 (403 if member but wrong role)
  │
  ▼
Prisma query, scoped by organizationId IN <caller's accessible orgs>
  │
  ▼
Response DTO (never a raw Prisma row)
```

Both guards and services call into the *same* `MembershipsService`
methods - there is exactly one implementation of "is this access allowed,"
never a guard's version and a service's version that could quietly drift
apart.

### Why cross-tenant access is 404, not 403

An organization/property outside the caller's access returns
`ORGANIZATION_NOT_FOUND` / `PROPERTY_NOT_FOUND` (404) whether it doesn't
exist at all, or exists but belongs to someone else - the two are
indistinguishable by design. If it instead returned 403 ("exists, but you
can't see it"), a caller could enumerate real organization/property ids by
noticing which ones 403 instead of 404. A `403 INSUFFICIENT_ROLE` is only
ever returned *after* membership is already established (e.g. a `STAFF`
member hitting an `OWNER`-only action) - at that point the caller already
knows the resource exists, so there is nothing left to leak.

### BOLA/IDOR protection: the query is scoped, never "load then check"

`PropertiesService`'s core lookup is one query:

```ts
prisma.property.findFirst({
  where: { id: propertyId, organizationId: { in: accessibleOrgIds } },
});
```

not:

```ts
// NEVER this - "load by id, then check ownership after" leaks a timing
// side channel and is one refactor away from someone deleting the check.
const property = await prisma.property.findFirst({ where: { id: propertyId } });
if (property.organizationId !== callerOrgId) throw new ForbiddenException();
```

`findOne`/`update`/`archive` all route through this one scoped lookup
(`findAccessiblePropertyRow`), so there is exactly one place in the
codebase that can get tenant isolation wrong, and it is covered by tests
that specifically construct a "property belongs to another organization"
scenario (`properties.service.spec.ts`, and end to end in
`phase2-organizations-properties.e2e-spec.ts`).

### Role rules (Phase 2)

| Action | OWNER | MANAGER | STAFF |
|---|---|---|---|
| View organization | ✓ | ✓ | ✓ |
| Update organization | ✓ | ✗ | ✗ |
| Create property | ✓ | ✓ | ✗ |
| View property | ✓ | ✓ | ✓ |
| Update property | ✓ | ✓ | ✗ |
| Archive ("delete") property | ✓ | ✗ | ✗ |

`MANAGER` can create/update properties (routine day-to-day operational
work an owner delegates) but cannot archive one or update the
organization itself - archiving affects every resident/staff member under
a property, and organization-level changes affect the whole business, both
a materially bigger blast radius than editing a property's address.
`SUPER_ADMIN` bypasses every one of these checks (platform-level access),
but is still blocked by organization suspension exactly like anyone else.

### Property lifecycle: archive, never hard-delete

`DELETE /properties/:id` sets `status: ARCHIVED` - it never issues a SQL
`DELETE`. A real property accumulates rooms, beds, tenants, and payment
history in later phases; destroying the parent row would destroy all of
that irrecoverably. An archived property is still readable
(`GET /properties/:id` still returns it) - "archived" means "no longer an
active listing," not "gone."

### Why the table isn't called `PG`

The model and table are `Property`/`properties`. "PG" is the product's
word for what this row represents today, but the same shape needs to
support hostels, co-living spaces, and student housing without a rename -
`Property.propertyType` (`PG | HOSTEL | CO_LIVING | STUDENT_HOUSING`) is
the extensible axis; the table name stays neutral forever.

### Membership invitation - deferred

Section 17 of the Phase 2 spec anticipates an eventual
Owner-invites-Manager flow (`OrganizationMembership.status: INVITED` →
accept → `ACTIVE`). It is deliberately **not** built in Phase 2: there is
no invitation endpoint, no invitation token, and no `INVITED` status in
the schema - adding a status Phase 2 never sets would be complexity
without purpose. When this lands (see "What Phase 3 needs" - not covered
in this document, see the Phase 2 implementation report), invitations
must use a signed, single-use, expiring token - never a guessable
sequential id - as their acceptance secret.

### Privacy/security principles this phase adds

- Client-supplied `organizationId` is data, never a credential -
  authorization always comes from a fresh `MembershipsService` lookup for
  the *authenticated* caller, never from trusting the field's presence.
- No endpoint ever returns a raw Prisma row - `OrganizationResponseDto`/
  `PropertyResponseDto` are built field-by-field, exactly like Phase 1's
  `UserResponseDto`, so a future column never silently becomes public API
  surface.
- `Organization.status: SUSPENDED` blocks every member, and blocks
  `SUPER_ADMIN` too - `SUPER_ADMIN` only bypasses the *membership*
  requirement, not organization suspension. Suspension is a property of
  the organization, not something any role can route around.

## Phase 3: property structure (rooms & beds)

### Organization → Property → Room → Bed

```
Organization
  │
  ▼
Property
  │
  ▼
Room (roomNumber, floor, roomType, capacity)
  │
  ▼
Bed (bedNumber)
```

Phase 3 extends the exact same authorization chain Phase 2 built, one
level deeper twice. No new authorization *mechanism* was introduced -
`RoomsService` and `BedsService` are both thin extensions that reuse
`MembershipsService`/`PropertiesService`/`RoomsService`'s own verified
lookups rather than re-deriving "is this accessible" from scratch (see
"Each layer of the ownership chain reuses the layer above it" under Key
decisions above).

### Room and bed lifecycle

- **Room**: `ACTIVE → ARCHIVED` (also `INACTIVE`, an operational pause
  short of archiving). `DELETE /rooms/:roomId` archives, it never issues a
  SQL `DELETE` - a room accumulates beds (and, from Phase 4, allocation
  history) that must survive.
- **Bed**: `AVAILABLE → ARCHIVED` (also `INACTIVE`). `DELETE
  /beds/:bedId` archives the same way. `UpdateBedDto.status` only accepts
  `AVAILABLE`/`INACTIVE` - never `ARCHIVED` - so a PATCH can never
  accidentally revive or archive a bed as a side effect; archiving is
  only ever the explicit, separately-logged `DELETE` action.
- Neither model is ever hard-deleted, for the same reason `Property`
  isn't (Phase 2): rooms and beds are exactly the rows Phase 4's
  `BedAllocation`/residency history will reference.

### Numbering rules

`Room.roomNumber` and `Bed.bedNumber` are strings ("101", "A-101",
"DORM-1", "B1" are all valid) - real-world numbering is never purely
numeric. Each is unique only within its immediate parent
(`@@unique([propertyId, roomNumber])`, `@@unique([roomId, bedNumber])`),
enforced by Postgres, never globally: "Room 101" existing in two
different properties, or "Bed B1" existing in two different rooms, is
normal, not a collision. A duplicate raises Prisma's P2002, already
mapped to `409 CONFLICT` by `AllExceptionsFilter` - no separate
`DUPLICATE_ROOM_NUMBER`/`DUPLICATE_BED_NUMBER` error code was added, since
the existing generic handling (the same one Phase 1's duplicate
email/phone and Phase 2's duplicate membership already rely on) covers it
identically.

### Capacity: the invariant and how it's enforced under concurrency

**`Room.capacity` is a hard ceiling on non-archived beds.** Creating a bed
fails once the room's `AVAILABLE`/`INACTIVE` bed count would exceed it;
archived beds never count against it (an archived bed is retired
inventory, not a phantom occupant). Reducing `capacity` below the current
non-archived bed count is rejected.

This cannot be safely enforced with a plain "count, then insert" - two
concurrent requests could both read the same under-capacity count and
both insert, silently exceeding it. Instead, both bed creation
(`BedsService.create`) and a capacity reduction (`RoomsService.update`)
wrap their read-then-write in a transaction that starts with:

```sql
SELECT id FROM rooms WHERE id = $1 FOR UPDATE
```

`FOR UPDATE` takes a row lock on that specific room for the transaction's
duration. A second, concurrent request touching the *same* room blocks
until the first commits or rolls back, then reads an up-to-date count -
there is no window where both can observe the same "not yet at capacity"
snapshot. Two requests touching *different* rooms take different locks
and proceed fully in parallel; there is no global bottleneck. The
`(roomId, bedNumber)` unique constraint separately guarantees a duplicate
bed number can never succeed twice, independent of this lock.

### Property/room "active" gating on creation

Creating a room requires the property to be `ACTIVE` (not `INACTIVE` or
`ARCHIVED`). Creating a bed requires *both* the property and the room to
be `ACTIVE`. This gate applies only to creation - reading, updating, or
archiving an existing room/bed is unaffected by its parent's status
(consistent with how `Property.update` in Phase 2 isn't blocked by the
property's own status either; only organization suspension blocks
everything, at every level, unconditionally).

### BOLA/IDOR protection, extended one and two levels deeper

`RoomsService.getAccessibleRoomOrThrow(user, propertyId, roomId)` is one
query:

```ts
prisma.room.findFirst({
  where: {
    id: roomId,
    propertyId, // rejects a roomId borrowed from a different property's URL
    property: { organizationId: { in: accessibleOrgIds } },
  },
});
```

`BedsService` reuses this rather than re-querying the organization chain
itself: it calls `RoomsService.getAccessibleRoomOrThrow` first (which
already proves the room belongs to `propertyId` and an accessible
organization), then does `prisma.bed.findFirst({ where: { id: bedId,
roomId } })`. This two-step form is exactly as safe as one giant
`bed → room → property → organization` query would be: a bed whose real
`roomId` differs (borrowed from another room's URL) can never match, and
there is no window where a bed is read before its room's authorization is
checked - see `beds.service.ts` for the full reasoning.

Both mismatched-relationship attacks spec section 8 calls out are
rejected identically to a nonexistent resource (404, not 403 or a
distinguishable error): a room id from Property A used with Property B's
id in the URL, and a bed id used with the wrong room. Verified in both
`beds.service.spec.ts` (unit) and `phase3-rooms-beds.e2e-spec.ts` (a real
User B attempting exactly this against a real User A's inventory).

### Role rules (Phase 3)

Identical split to Property (Phase 2) - MANAGER handles day-to-day
inventory, archiving is OWNER-only:

| Action | OWNER | MANAGER | STAFF |
|---|---|---|---|
| View room/bed | ✓ | ✓ | ✓ |
| Create/update room | ✓ | ✓ | ✗ |
| Archive room | ✓ | ✗ | ✗ |
| Create/update bed | ✓ | ✓ | ✗ |
| Archive bed | ✓ | ✗ | ✗ |

### API endpoints

```
POST/GET    /properties/:propertyId/rooms
GET/PATCH/DELETE /properties/:propertyId/rooms/:roomId
POST/GET    /properties/:propertyId/rooms/:roomId/beds
GET/PATCH/DELETE /properties/:propertyId/rooms/:roomId/beds/:bedId
```

Nested (never top-level `/rooms`/`/beds`) so every request URL always
carries the full chain the server verifies - there is no route where a
room or bed id alone would be enough to act on it.

### Deferred to Phase 4: BedAllocation and Residency

`Tenant` and `BedAllocation` already existed in the schema (scaffolded in
Phase 0) but neither was built on by Phase 3 - no service, no controller,
no fake/placeholder relationship was added to make them "fit" that phase.
Phase 3 only built the physical inventory (`Room`, `Bed`) that Phase 4's
real `TenantsService`/`ResidenciesService` schedules people into (see
"Phase 4: tenants, residency & bed allocation" below for what actually
landed, including where the Phase 0 scaffold's shape changed).

The critical invariant this section anticipated - *a bed cannot have two
overlapping active allocations* - is what Phase 4 implements, and
deliberately not via an application-level `if`: see below for the two
partial unique indexes that actually guarantee it.

## Phase 4: tenants, residency & bed allocation

### User → Tenant → Residency → BedAllocation → Bed → Room → Property → Organization

```
User
  │
  ▼
Tenant                 ("this platform user is/has been a resident somewhere")
  │
  ▼
Residency               ("this tenant is/was staying at this property, this period")
  │
  ▼
BedAllocation           ("during that stay, this specific bed, this specific window")
  │
  ▼
Bed → Room → Property → Organization
```

Each arrow is a distinct question, and conflating any two of them was
exactly the mistake this chain avoids: authenticating (Phase 1) does not
imply being a tenant; being a tenant does not imply an active stay
anywhere (a `Tenant` row can exist with zero, one, or many historical
`Residency` rows); an active residency does not imply KYC verification
(separate domain, Phase 1); and a residency does not by itself say which
physical bed - that is `BedAllocation`'s job, one layer further down.

### Why Tenant changed shape from the Phase 0 scaffold

Phase 0 originally modeled `Tenant` as an organization-scoped guest record
(`organizationId`, `name`, `phone`, `email`, `status`, optional `userId`) -
a reasonable guess before Phase 4's real requirements were known, but in
tension with two things this phase actually needs: `Residency` (not
`Tenant`) is what should be organization/property-scoped, since the same
person moving from Org A's PG to Org B's PG must stay the *same* tenant
identity (spec section 23's `userId UNIQUE`); and `name`/`phone`/`email`
duplicated `User` for no reason once `userId` is mandatory. Both tables
were still completely empty (no service had ever been built against
them through Phase 3), so this phase replaced the shape outright rather
than bolting a `Residency` model on top of the old one - see "Phase 3:
property structure"'s note on the Room/Bed rename for the same reasoning
applied one phase earlier. `Tenant` is now exactly `{id, userId,
createdAt, updatedAt}` - a marker, not a profile.

### Why Residency and BedAllocation are two separate models

`Residency.bedId` was deliberately never added. If it had been, moving a
resident from one bed to another mid-stay (a future "transfer" feature -
see below) would require either mutating history in place (destroying
"who was in Bed A from Jan-Mar") or inventing a parallel history table
after the fact. Instead:

```
Residency #1 (Tenant X, Property A, Jan 1 → active)
  ├── BedAllocation: Bed A101-B1, Jan 1 → Mar 10 (ENDED)
  └── BedAllocation: Bed A101-B2, Mar 10 → (ACTIVE)
```

Ending one allocation and starting another under the same `Residency` is
exactly what a future bed-transfer endpoint will do - Phase 4 does not
implement that endpoint (not required by this phase's scope), but the
two-model split is what makes it possible later without a schema change
or a history-destroying migration.

### Residency lifecycle

```
PENDING ──check-in──▶ ACTIVE ──(future: give notice)──▶ NOTICE_PERIOD
                         │                                    │
                         └──────────check-out─────────────────┴──▶ CHECKED_OUT
```

- **`PENDING`** - set at creation (`POST /properties/:propertyId/residencies`).
  No bed is allocated yet; this only records "this tenant is scheduled to
  move into this property."
- **`ACTIVE`** - set only by check-in (`POST /residencies/:id/check-in`),
  atomically with creating the `BedAllocation`.
- **`NOTICE_PERIOD`** - part of the intended shape, kept in the enum now
  the same way `MembershipStatus.REMOVED` was added in Phase 2 before any
  endpoint set it - no "give notice" action exists yet, so nothing in
  Phase 4 ever sets this value; check-out already accepts it as a valid
  pre-checkout state so that future action slots in without a schema
  change.
- **`CHECKED_OUT`** - terminal, set only by check-out, atomically with
  ending the `BedAllocation`.

**PATCH can never change `status`.** `UpdateResidencyDto` has exactly one
field (`expectedEndDate`) - lifecycle transitions are check-in/check-out
only, per spec sections 17-18. A client sending `{"status":"ACTIVE"}` to
a PATCH endpoint has no field to put it in; there is no way to skip
check-in.

### BedAllocation lifecycle

`AVAILABLE`/`INACTIVE`/`ARCHIVED` (`BedStatus`, Phase 3) describes a bed's
own physical lifecycle and is **never changed by check-in or check-out** -
per spec section 12, a bed does not gain an `OCCUPIED` status. Whether a
bed currently has someone in it is answered entirely by whether it has an
allocation with `status: ACTIVE`, not by any column on `Bed` itself:

- Check-in creates a new `BedAllocation` row (`status: ACTIVE`).
- Check-out sets that row to `status: ENDED` with an `endDate` - it is
  never deleted, and a bed becoming "available again" is simply the
  absence of any remaining `ACTIVE` row for it, nothing is toggled on
  `Bed`.

### Check-in: the full verification chain and its atomicity boundary

`POST /residencies/:id/check-in` (`ResidenciesService.checkIn`) runs, in
order: JWT (guard) → organization membership + role
(`getAccessibleResidencyOrThrow` + `assertRole`) → residency must be
`PENDING` → the bed must belong to the *same property* the residency is
at (`bed.findFirst({ where: { id: bedId, room: { propertyId:
residency.propertyId } } })` - a bed from a different property simply
never matches, so this is a 404, not a 403) → property/room/bed must all
be `ACTIVE`/`AVAILABLE` → no existing `ACTIVE` allocation on that bed →
finally, in one transaction, create the `BedAllocation` and flip the
residency to `ACTIVE`. If any step fails, nothing partially happens -
either both writes commit or neither does.

`CheckInDto` has exactly one field, `bedId` - no `roomId`, no
`propertyId`. This isn't an omission; it removes the entire class of
"client sends a mismatched room/property" bugs spec section 14 warns
about, because there is no second field for the two to disagree on. The
room and property a bed belongs to are always read from the database
relation on the bed itself.

### Check-out

`POST /residencies/:id/check-out` requires the residency to be `ACTIVE`
or `NOTICE_PERIOD` (anything else - including already `CHECKED_OUT` - is
`INVALID_CHECKOUT`, rejecting a double checkout). In one transaction: the
active `BedAllocation` gets `status: ENDED` + `endDate: now`, and the
`Residency` gets `status: CHECKED_OUT` + `actualEndDate: now`. Nothing is
deleted - both rows remain readable exactly as Phase 3 archiving leaves
Property/Room/Bed rows readable.

### The two invariants, and how PostgreSQL actually enforces them

**"A bed cannot have two overlapping active allocations"** (spec section
10, the most important Phase 4 requirement) and **"a tenant should not
have two simultaneously active/pending residencies"** (section 27) are
each backed by a partial unique index, added by hand in this phase's
migration SQL (Prisma's schema DSL cannot express a `WHERE` clause on a
unique index - same limitation Phase 0 already documented for bed
allocations):

```sql
CREATE UNIQUE INDEX residencies_active_tenant_unique
  ON residencies ("tenantId") WHERE status = 'ACTIVE';

CREATE UNIQUE INDEX bed_allocations_active_bed_unique
  ON bed_allocations ("bedId") WHERE status = 'ACTIVE';
```

Application-level pre-checks exist too (in `create()` and `checkIn()`),
but only for a fast, friendly error in the common case - they are **not**
what makes this safe under concurrency, and the code says so at each
call site. Two simultaneous check-in requests can both pass every
pre-check (both read "no active allocation yet" before either has
written anything) and both reach the `INSERT` - Postgres allows exactly
one of the two matching rows to exist under the partial index, so the
loser's `INSERT` raises a unique-violation (P2002), which
`ResidenciesService.checkIn`'s `catch` block inspects
(`error.meta.target`) and translates into `BED_ALREADY_OCCUPIED` or
`TENANT_ALREADY_ALLOCATED` - never a raw database error reaching the
client.

**This was proven against the real database, not just argued.** Two
tenants' residencies were checked in against the same single-capacity bed
with `Promise.all` (genuinely overlapping requests, not sequential calls)
against the live server: exactly one call returned `200 ACTIVE`, the
other returned `409 BED_ALREADY_OCCUPIED`, and a direct SQL query
afterward showed exactly one row in `bed_allocations` for that bed, with
`status = 'ACTIVE'`. See the Phase 4 implementation report's manual
verification section for the full transcript.

### Organization isolation, extended two more levels

`ResidenciesService.getAccessibleResidencyOrThrow` is the same
single-query BOLA pattern as Room/Bed, one level below Property:

```ts
prisma.residency.findFirst({
  where: {
    id: residencyId,
    property: { organizationId: { in: accessibleOrgIds } },
  },
});
```

`TenantsService` is the one place this pattern gets a twist: a `Tenant`
has no `organizationId` of its own (it's global, per the redesign above),
so "can this caller see this tenant" is answered by checking whether the
caller *shares a `Residency`* with the tenant in one of their accessible
organizations - self, `SUPER_ADMIN`, or "has a residency together" are
the only three ways in; everyone else gets the same 404 a nonexistent
tenant would (see `TenantsService.findOne`).

### Role authorization (Phase 4)

Same `MembershipsService`/`assertRole` mechanism as every prior phase -
no second permission system:

| Action | OWNER | MANAGER | STAFF |
|---|---|---|---|
| View residency | ✓ | ✓ | ✓ |
| Create/update residency | ✓ | ✓ | ✗ |
| Check in / check out | ✓ | ✓ | ✗ |

Check-in/check-out are treated as ordinary day-to-day operational actions
here (both `OWNER` and `MANAGER`), not as an OWNER-only "archive" -
unlike Property/Room/Bed's OWNER-only delete, a manager routinely
checking a resident in or out is normal daily work, not a structural
decision about the business.

### Tenant/Residency APIs deliberately reduced from the spec's full list

`Tenant` only exposes `POST /tenants` (self only - `userId` is always the
caller) and `GET /tenants/:id`. No `GET /tenants` (a platform-wide list
with no caller who needs it) and no `PATCH /tenants/:id` (there is
nothing left to edit once `Tenant` is reduced to `{id, userId,
timestamps}` - see "Why Tenant changed shape" above). This directly
follows the spec's own instruction to keep Tenant APIs minimal and not
add fields/endpoints "because they might be useful later."

### Archived/inactive resources never block reads of history

Archiving a `Property`/`Room`/`Bed` blocks *new* residencies/check-ins
against it (`PROPERTY_NOT_ACTIVE`/`ROOM_NOT_ACTIVE`/`BED_NOT_ACTIVE`) but
never affects reading an existing `Residency`/`BedAllocation` - a
tenant's stay history at a property that later got archived remains
fully readable, exactly as Phase 3 keeps archived rooms/beds themselves
readable.

### Future bed transfer (not implemented in Phase 4)

A transfer would end the current `BedAllocation` (`status: ENDED`,
`endDate: now`) and create a new one under the *same* `Residency` in one
transaction - no new model, no schema change, because `BedAllocation`
already exists as a separate history table for exactly this reason (see
above). Not built in Phase 4 because nothing in this phase's scope
requires it yet.

## Phase 5: rent & invoices

### Residency → RentPlan → Invoice → InvoiceItem

```
Residency               ("this tenant is/was staying at this property, this period")
  │
  ▼
RentPlan                ("the agreed monthly amount, and since when")
  │                     (audit-trace only - never read back for totals)
  ▼
Invoice                 ("a billed period: subtotal/discount/tax/total, a snapshot")
  │
  ▼
InvoiceItem             ("one priced line on that invoice")
```

`RentPlan` and `Invoice` are deliberately separate models, the same way
Phase 4 kept `Residency` and `BedAllocation` separate: a `RentPlan` is the
*current agreement*, an `Invoice` is a *historical financial fact*. Once
an invoice is generated, changing the residency's rent plan later must
never alter it - `Invoice.rentPlanId` exists only so a human can trace
"which plan produced this," not so the system can recompute a total from
it.

### RentPlan lifecycle and history

Creating a new `RentPlan` for a residency (`POST
/residencies/:residencyId/rent-plan`) never overwrites the existing one:
in one transaction, any current `ACTIVE` plan is closed
(`status: INACTIVE`, `effectiveTo` set to the new plan's
`effectiveFrom`) and the new plan is created `ACTIVE`, mirroring how
Phase 4 closes out a `BedAllocation` rather than mutating it. A new
plan's `effectiveFrom` must be strictly after the current plan's - the
one hand-written partial unique index,
`rent_plans_active_residency_unique` (`WHERE status = 'ACTIVE'`), is what
actually guarantees "at most one active plan per residency" under
concurrent creation; the application-level check in
`RentPlansService.create` is only the friendly-error fast path, and a
caught `P2002` on that constraint is translated into `INVALID_RENT_PLAN`
rather than leaking a raw database error. `PATCH /rent-plans/:id` is
deliberately narrow - only `dueDay` (a correction) or `deactivate: true`
(an action flag) - there is no way to `PATCH` the `amount`; changing rent
means creating a new plan, so the history above is never bypassed.

### Billing period and calendar math

A billing period is always a full calendar month, computed server-side
from `year`/`month` in `POST /residencies/:residencyId/invoices` - the
client never supplies dates directly:

```ts
periodStart = Date.UTC(year, month - 1, 1)
periodEnd   = Date.UTC(year, month, 0)   // day 0 of next month = last day of this one
```

`Date.UTC(year, month, 0)` is used deliberately instead of a hand-rolled
28/29/30/31 lookup table, so leap years are handled by the platform's own
calendar logic rather than a maintained constant. `computeDueDate` clamps
`dueDay` the same way - `Math.min(dueDay, lastDayOfMonth)` - so a plan
with `dueDay: 31` due-dates correctly to Feb 28/29 instead of overflowing
into March.

### Proration formula

When a residency's occupied window inside the billing period is shorter
than the full period (a mid-month check-in or a mid-month checkout), the
invoice subtotal is prorated using inclusive day counts:

```
occupiedDays = inclusiveDayCount(occupiedStart, occupiedEnd)
daysInPeriod = inclusiveDayCount(periodStart, periodEnd)
subtotal     = occupiedDays >= daysInPeriod
                 ? monthlyAmount                                    // full period - no rounding drift
                 : round(monthlyAmount * occupiedDays / daysInPeriod, 2, HALF_UP)
```

Both endpoints of a day range are counted (`inclusiveDayCount(Jan 1, Jan
1) === 1`, not `0`) so a resident occupying a single calendar day is
still billed for that day. The occupied window itself is the overlap of
the residency's own `startDate`/`actualEndDate` with the billing period,
clamped both ways - a residency that started before this period bills
the full period from that side, and one that hasn't ended yet by
`periodEnd` also bills the full period from that side. `RentPlan`
coverage is checked against this *occupied* window, not the full calendar
period, so a rent plan that only starts mid-month (matching a mid-month
check-in) is not incorrectly rejected as "not yet effective."

### Invoice lifecycle and immutability

```
DRAFT ──issue──▶ ISSUED ──(due date passes, evaluated lazily on read)──▶ OVERDUE
  │                 │
  └────void─────────┴──▶ VOID
```

- **`DRAFT`** - created by `generateForResidency`; `subtotal`/`discount`/
  `tax`/`total`/items are already computed and persisted, but the invoice
  is not yet final. `PATCH /invoices/:id` (currently just `dueDate`) is
  only permitted in this state.
- **`ISSUED`** - set by `POST /invoices/:id/issue`. From this point the
  invoice is immutable: no endpoint can change its amounts, items, or
  billing period ever again, per spec section 30 - correcting a mistake
  means voiding and generating a new invoice, never editing an issued
  one.
- **`OVERDUE`** - there is no cron/scheduler infrastructure in this
  project (confirmed before building this), so this transition is
  evaluated **lazily**: `InvoicesService.evaluateOverdue()` runs on every
  read and flips `ISSUED → OVERDUE` in place if `dueDate` has passed,
  rather than relying on a background job that doesn't exist.
- **`VOID`** - terminal, set by `POST /invoices/:id/void`; an already-void
  or already-reissued-for-that-period invoice cannot be voided again
  (`INVALID_INVOICE_STATE`).

### Duplicate billing protection

**"One invoice per residency per billing period"** (spec section 28) is
backed by a plain named unique constraint - unlike Phase 4's partial
indexes, this one needs no `WHERE` clause, so it's expressed directly in
`schema.prisma`:

```prisma
@@unique([residencyId, billingPeriodStart, billingPeriodEnd], name: "invoices_residency_billing_period_unique")
```

The same pre-check-then-transaction pattern as Phase 4 applies: an
application-level lookup gives a friendly `409 DUPLICATE_BILLING_PERIOD`
in the common case, but the constraint itself is what makes it safe when
two requests genuinely race - the loser's `INSERT` raises a P2002, caught
and translated the same way. **Proven against the real database**: two
simultaneous `POST /residencies/:id/invoices` calls for the same
residency and billing period, fired with `Promise.all` against the live
server, returned exactly one `201` and one `409
DUPLICATE_BILLING_PERIOD`; a direct SQL query afterward confirmed exactly
one row in `invoices` for that period.

### Invoice numbering

`invoiceNumber` (`INV-<year>-<6-digit-sequence>`, e.g. `INV-2027-000042`)
is generated from a dedicated Postgres sequence
(`SELECT nextval('invoice_number_seq')`) inside the same transaction that
creates the invoice - never `COUNT(*) + 1`, which is not concurrency-safe
(two simultaneous inserts can both read the same count before either
commits, producing duplicate numbers). A Postgres sequence guarantees
every caller gets a distinct value even under a genuine race, with no
extra locking required.

### Money handling

Every monetary field (`RentPlan.amount`, `Invoice.subtotal/discount/tax
/total`, `InvoiceItem.unitAmount/amount`) is `Decimal @db.Decimal(12, 2)`
in Postgres and `Prisma.Decimal` in application code - see "Money is
never a JS number" above. Proration divides using `Prisma.Decimal`
arithmetic and rounds with `ROUND_HALF_UP` to exactly 2 decimal places;
API responses always serialize these fields as decimal strings
(`"4064.52"`), never as JS numbers, so no client can lose precision by
parsing a `float`.

### Multi-tenant authorization (Phase 5)

The reuse chain extends one and two levels further, five phases deep:
`RentPlansService`/`InvoicesService` both call
`ResidenciesService.getAccessibleResidencyOrThrow` (made public in this
phase for exactly this reuse) rather than re-deriving organization
access, and `assertRole` is the same `MembershipsService` mechanism used
since Phase 2:

| Action | OWNER | MANAGER | STAFF |
|---|---|---|---|
| View rent plan / invoice | ✓ | ✓ | ✓ |
| Create/update rent plan | ✓ | ✓ | ✗ |
| Generate/update invoice | ✓ | ✓ | ✗ |
| Issue / void invoice | ✓ | ✓ | ✗ |

Every rent-plan/invoice lookup is the same single-scoped-query BOLA
pattern as every prior phase, so a resource belonging to another
organization 404s rather than 403s - confirmed in
`phase5-rent-invoices.e2e-spec.ts` for every rent-plan and invoice action
against an unrelated "Organization B" account.

### Explicitly out of scope in Phase 5 (delivered in Phase 6)

Payments were Phase 6. Razorpay was Phase 6. Payment webhooks were
Phase 6. Nothing in Phase 5 itself recorded a payment, marked an invoice
"paid," talked to any payment gateway, or reconciled anything -
`InvoiceStatus` had no `PAID`/`PARTIALLY_PAID` value at the end of
Phase 5, on purpose, since those states only make sense once a Payment
domain exists to set them correctly. See "Phase 6: tenant payments,
platform fee & owner settlement" below for what actually added them.

## Phase 6: tenant payments, platform fee & owner settlement

### Two separate money flows - only one of which this phase touches

This platform has two distinct financial relationships, and Phase 6
deliberately builds only one of them:

```
Flow A (this phase): Tenant → Payment → Platform Fee → Owner Settlement
Flow B (Phase 7, not built): PG Owner → Subscription → Platform
```

Flow A is a tenant paying their PG rent; Flow B is the owner's own
recurring bill for using this SaaS platform. They share no model, no
service, and no endpoint - `Payment` is never used to represent a
subscription charge, and nothing in this phase reads or writes anything
subscription-shaped. Conflating the two would make a future subscription
feature accidentally inherit invoice/residency/tenant semantics that make
no sense for it (a subscription has no `Residency`, no `Invoice`, no
tenant "payer" at all - it's the owner paying the platform, not a
resident paying an owner).

### Residency → RentPlan → Invoice → Payment → Platform Fee → Owner Settlement

```
Residency                ("this tenant is/was staying at this property, this period")
  │
  ▼
Invoice                  (Phase 5, unchanged - the billed amount, a snapshot)
  │
  ▼
Payment                  ("this tenant attempted/completed paying (part of) that invoice")
  │                      (amount is always the GROSS amount charged)
  ├── PaymentAllocation  ("this much of this payment counts toward this invoice's balance")
  └── OwnerSettlement    ("the owner's share of this payment, tracked separately")
```

`Payment` and `Invoice` stay separate for the same reason Phase 5 kept
`RentPlan` and `Invoice` separate: a `Payment` is an attempt/transaction
(it can fail, get retried, get refunded), while `Invoice.total` is a
fixed, immutable-once-issued fact. Nothing about *how* an invoice gets
paid should ever be able to mutate *what* it says was owed.

### Different rent, different invoices, one Payment mechanism

Phase 5 already made rent residency-specific
(`Residency → RentPlan → Invoice`, never a single `Property.rent` or a
shared PG-wide amount) - Phase 6 does not touch that model at all.
`PaymentsService` never reads `RentPlan.amount`; it only ever reads
`Invoice.total` and the sum of existing `PaymentAllocation` rows for that
specific invoice. Two residents in the same room with different rents
(`₹8,000` vs `₹10,000`, spec sections 5-7) simply produce two invoices
with two different `total`s, and each is paid down independently - the
payment layer has no concept of "PG-wide rent" to get wrong.

### Payment lifecycle

```
CREATED ──gateway order created──▶ PENDING ──checkout──▶ AUTHORIZED
                                                              │
                                                          capture
                                                              ▼
                              FAILED / CANCELLED          CAPTURED ──▶ REFUNDED / PARTIALLY_REFUNDED
```

- **`CREATED`** - the internal `Payment` row exists; no gateway order yet.
- **`PENDING`** - a Razorpay order has been created (`providerOrderId`
  set); the tenant has not completed checkout.
- **`AUTHORIZED`** - `POST /payments/:id/verify` confirmed a valid
  signature but the gateway has not yet reported the payment `captured`
  (an intermediate state some payment methods pass through).
- **`CAPTURED`** - money has been received. This is the *only* status
  that ever creates a `PaymentAllocation` - see `finalizeCapturedPayment`
  below. Set from either `POST /payments/:id/verify` (client-side path)
  or the `payment.captured` webhook (server-side path), whichever arrives
  first; the other is a no-op (see idempotency below).
- **`FAILED`** / **`CANCELLED`** - terminal, no money moved, no allocation
  ever created.
- **`REFUNDED`** / **`PARTIALLY_REFUNDED`** - set by `POST
  /payments/:id/refund`, only reachable from `CAPTURED`.

Every transition is decided by `PaymentsService`, never a client-supplied
`status` field (spec section 13) - the same "action-based, not `PATCH
{status}`" principle every prior phase's lifecycle uses.

### Invoice payment status

`InvoiceStatus` gained `PARTIALLY_PAID` and `PAID` this phase (spec
section 14). Both are set inside the same transaction that creates a
`PaymentAllocation` - never inferred separately - by comparing the new
total allocated amount against `Invoice.total`:

```
ISSUED / OVERDUE ──partial payment──▶ PARTIALLY_PAID ──full payment──▶ PAID
```

`VOID` is untouched by any payment code path - a voided invoice is
rejected before a `Payment` can even be created against it
(`INVOICE_NOT_PAYABLE`).

### Outstanding balance and overpayment protection

```
outstanding = Invoice.total - SUM(PaymentAllocation.amount for this invoice)
```

computed fresh on every order-creation request, in exact `Prisma.Decimal`
arithmetic - never cached on `Invoice`, never `parseFloat` (spec sections
15/39). `POST /invoices/:invoiceId/payments/order` rejects any requested
amount greater than this value with `409
AMOUNT_EXCEEDS_OUTSTANDING_BALANCE` (spec section 16) - a client can never
create a credit balance by accident.

### The concurrency guard: a row lock, not a unique index

**"Two simultaneous payments for the same remaining balance - only one
should succeed"** (spec section 44) cannot be solved the way Phase 4/5
solved their concurrency invariants. `bed_allocations_active_bed_unique`
and `invoices_residency_billing_period_unique` are both "at most one row
may look like this" constraints - a single Postgres unique index handles
them perfectly. Phase 6's invariant - "the sum of `PaymentAllocation`
rows for an invoice may never exceed `Invoice.total`" - is a constraint
over an *aggregate of many rows*, which no unique or exclusion constraint
can express.

`PaymentsService.finalizeCapturedPayment` instead takes a
transaction-scoped `SELECT ... FROM invoices WHERE id = $1 FOR UPDATE`
lock on the invoice row before reading the current allocation total -
the same "locked read-then-write" technique `RoomsService` already uses
for bed-capacity checks (Phase 3). Two concurrent finalizations for the
same invoice serialize on that lock: the first to acquire it reads the
allocation total, allocates, and commits; the second then reads the
*updated* total, sees nothing left to allocate, and marks its own payment
`FAILED` with `failureCode: OVERPAYMENT_REJECTED` - never a raw database
error, and never a double-allocation.

**Proven against the real database, not just argued** - a one-off script
ran two genuinely concurrent `finalizeCapturedPayment` calls for two
₹5,000 payments against a single ₹5,000 invoice: exactly one resolved
`CAPTURED`, the other `FAILED`, with exactly one `PaymentAllocation` row
and the invoice landing on `PAID`. See "Testing strategy" above for the
full transcript and the real bug this same exercise caught.

### Platform fee: configurable, never hardcoded

`PlatformFeeService.calculateFee` reads the single active
`PlatformFeeRule` row (currently `FIXED, amount: 1.00`, seeded by this
phase's migration) rather than any code containing the literal value `1`
(spec section 19). The fee is capped at the gross amount
(`Prisma.Decimal.min(rule.amount, grossAmount)`) so a payment smaller than
the configured fee still nets the owner exactly `0`, never a negative
settlement (spec section 20). Changing the fee later is a new
`PlatformFeeRule` row, never a deployment - and because `Payment
.platformFee` is snapshotted at order-creation time, a later rule change
never alters an already-created payment's recorded breakdown.

### Owner settlement: a separate fact from "the tenant paid"

Spec section 36 is explicit that `Payment` and `OwnerSettlement` must
never be confused, and the schema enforces that separation structurally,
not just by convention: `OwnerSettlement` is its own table
(`@@unique` on `paymentId` - at most one per payment), created inside the
same transaction that marks a `Payment` `CAPTURED`, starting at
`PENDING`. A settlement's own `status`
(`PENDING → PROCESSING → SETTLED`, or `FAILED`) never feeds back into
`Payment.status` - a `FAILED` settlement leaves the tenant's payment
exactly as `CAPTURED` as it already was, because the tenant's money was
genuinely received; only the owner's payout has a problem, and that is
purely an operational/reconciliation concern for the platform to resolve
with the gateway.

`OwnerPaymentAccount` (one per organization, `@unique` on
`organizationId`) is where a real transfer would be sent via
`PaymentGateway.createTransfer` (Razorpay Route/linked-account transfers,
spec section 21) - Phase 6 creates the `OwnerSettlement` record and wires
the transfer call, but this environment has no live Razorpay Route
account to actually settle funds against (see "Known limitations" in the
final report) - the record-keeping and the gateway call are both real;
only end-to-end settlement against a live linked account is unverified.

### Razorpay: isolated behind one interface

`PaymentGateway` (`src/modules/payments/gateway/payment-gateway
.interface.ts`) is the only thing `PaymentsService`/`PaymentsWebhookService`
depend on - `RazorpayGatewayService` is the sole implementation, injected
via the `PAYMENT_GATEWAY` DI token (spec section 27). No other file in
this codebase imports the `razorpay` package or knows an HMAC formula.
Order creation, payment-signature verification, webhook-signature
verification, fetching a payment, creating a Route transfer, and
refunding all go through this one seam - a second gateway later is a new
class and a config switch, never a `PaymentsService` rewrite.

### Money: exact Decimal-to-paise conversion

`decimalToSmallestUnit`/`smallestUnitToDecimal`
(`src/modules/payments/money.util.ts`) convert between `Prisma.Decimal`
rupees and integer paise using `Decimal.times(100)`/`.dividedBy(100)`
arithmetic, never `amount * 100` on a JS float (spec section 30) - `₹0.29`
converts to exactly `29` paise, where naive float multiplication produces
`28.999999999999996`.

### Idempotency: two independent layers

- **Webhook delivery** - `@@unique([provider, eventId])` on
  `WebhookEvent` (spec sections 31-33). A duplicate delivery's insert
  raises `P2002`, caught and treated as "already processed, acknowledge
  and no-op" before any financial code runs.
- **Order creation** - an optional client-supplied `Idempotency-Key`
  header (spec section 34), stored on `Payment.idempotencyKey`
  (`@unique`). A retried request with the same key returns the original
  `Payment`'s order info instead of creating a second one; the unique
  constraint (not just the pre-check) is what makes this safe under a
  genuine retry race, the same "friendly pre-check, DB constraint is the
  real guarantee" pattern every prior phase uses.

Both are backed by a real Postgres unique constraint, not an
in-application cache or lock - the same principle as every other
concurrency guarantee in this codebase.

### Refund foundation

`POST /payments/:id/refund` (OWNER/MANAGER only - never the tenant
themselves, spec section 26) calls `PaymentGateway.refundPayment`, records
a `Refund` row, and reduces the payment's `PaymentAllocation` amount so
the invoice's outstanding-balance calculation reflects it (stepping the
invoice back down from `PAID`/`PARTIALLY_PAID` if needed). If the
associated `OwnerSettlement` had already reached `PROCESSING`/`SETTLED`,
it is flagged `REVERSED` as an accounting fact. **What this does not do**
(spec section 37 explicitly allows deferring this): it does not invent an
automatic mechanism to claw back funds already transferred to an owner's
linked account - that is a real gateway capability (Razorpay Route
transfer reversal) this phase's `PaymentGateway` interface has a seam for
(`createTransfer`'s counterpart) but does not implement, since it cannot
be verified without a live linked account.

### Authorization: a new, narrower lookup than every prior phase

Every phase through 5 scoped resource access to organization membership.
Phase 6 needed a genuinely new authorization shape, because **the payer
is not an organization member at all** - a tenant is connected to an
organization only indirectly, through `Residency.tenant.userId` (spec
section 25):

```
JWT → User → (Residency.tenant.userId === user.id) → Invoice → Payment
```

`PaymentsService` fetches an invoice by id alone (joining
`residency.tenant` and `residency.property`), then branches on three
legitimate viewers - the residency's own tenant, an active
OWNER/MANAGER/STAFF member of the owning organization (view-only), or
`SUPER_ADMIN` - the same "fetch once, branch on access" pattern
`TenantsService.findOne` already established in Phase 4 for exactly this
reason (a resource with more than one legitimate but structurally
different kind of viewer). Order creation and refund each further narrow
this to exactly one of those branches (payer-only; OWNER/MANAGER-only,
respectively) - confirmed in `phase6-tenant-payments.e2e-spec.ts` for
every payment action against an unrelated user and an unrelated
organization.

### Explicitly out of scope (Phase 7 and beyond)

The owner's own SaaS subscription to this platform is Phase 7 - plans,
monthly recharge, subscription status, renewal, grace period, suspension,
and owner subscription invoices. Nothing in Phase 6 records a
subscription charge, and `Payment`/`Invoice` are never reused to
represent one (see "Two separate money flows" above).

## Roadmap

Phase 0 (done) → Phase 1 (done): platform identity, auth, sessions, KYC
foundation → Phase 2 (done): organizations + properties +
`OrganizationMembership`-based authorization → Phase 3 (done): rooms +
beds → Phase 4 (done): tenants + residency + bed allocation → Phase 5
(done): rent + invoices → Phase 6 (this repository, done): tenant
payments + platform fee + owner settlement (Razorpay) → Phase 7: owner
SaaS subscription (plans, recharge, renewal, grace period, suspension) →
Phase 8: complaints → Phase 9: food/menu → Phase 10: notifications.
