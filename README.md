# PG Backend

Backend API for a multi-tenant PG (Paying Guest) management SaaS platform.
NestJS + TypeScript + PostgreSQL (Prisma), built as a modular monolith.

This repository is backend-only. The mobile apps (owner/manager and
student) are separate React Native / Expo projects and are not part of
this codebase.

## Status: Phase 2 - Organizations, Properties & Multi-Tenant Authorization

Phase 0 delivered the foundation: project setup, configuration, database
connectivity, the core multi-tenant data model, global error handling,
health checks and tooling.

Phase 1 added platform user identity, JWT authentication with
refresh-token rotation, multi-device sessions, and the
identity-verification (KYC) domain foundation.

Phase 2 (this repository, current) adds organizations, organization
memberships, PG properties, and the multi-tenant authorization layer that
enforces "a user can only touch data in an organization they actively
belong to." It intentionally does **not** yet include rooms, beds,
tenants, residency, rent, payments, complaints, food, notifications, PG
applications, or visit booking - those come in later phases (see
"Roadmap" below).

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
    └── properties/           # Property CRUD, scoped entirely through MembershipsService
```

`rooms, beds, tenants, rent, payments, complaints, food, announcements,
notifications, subscriptions` do not exist as modules yet - they are
added incrementally, one module per phase. Creating empty module shells
ahead of the code that belongs in them would just be structure for its
own sake.

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

## Data model (Phase 0 + Phase 1 + Phase 2)

```
Organization (status: ACTIVE | INACTIVE | SUSPENDED)
├── OrganizationMembership (user + role: OWNER | MANAGER | STAFF | STUDENT)
│                          (status: ACTIVE | SUSPENDED | REMOVED)
└── Property (status: ACTIVE | INACTIVE | ARCHIVED; propertyType: PG | HOSTEL | ...)
    └── Room
        └── Bed
            └── BedAllocation (history: tenant + bed + start/end + status)

User ──< OrganizationMembership >── Organization
User ──(optional, 1:1)── Tenant
User ──< RefreshToken            (Phase 1: one row per active session/device)
User ──< IdentityVerification    (Phase 1: KYC foundation)
```

- `User` is pure identity (phone/email/name/password hash). It has no
  role field and no organization/property/room/bed field - see "Key
  decisions" above and the Phase 1/Phase 2 architecture sections below.
- `Tenant` is intentionally separate from `User`: an owner can check a
  tenant in before that person ever creates a login.
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
- `BedAllocation.status` is `ACTIVE | ENDED | CANCELLED`. Concurrency
  safety for "one bed, one active occupant" is enforced by a partial
  unique index (see "A note on the bed allocation constraint" above), not
  by application code alone.
- `PrismaClientKnownRequestError` (Prisma's own error type, e.g. a unique
  constraint violation) is mapped to the standard error envelope
  automatically by `AllExceptionsFilter` - a future module doesn't need
  its own try/catch for that (this is what Phase 1's duplicate
  email/phone handling, and Phase 2's duplicate-membership constraint,
  both rely on).

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
  BOLA/IDOR-safe lookup, and the OWNER/MANAGER/STAFF permission matrix).
- `test/*.e2e-spec.ts` - HTTP-level tests, run with `npm run test:e2e`.
  `PrismaService` is overridden with an in-memory fake in every e2e test
  so the suite does not require a running database; `auth.e2e-spec.ts`
  exercises the full register → login → `/me` → refresh-rotation →
  reuse-detection → logout flow, and
  `phase2-organizations-properties.e2e-spec.ts` exercises organization
  creation, property creation/read/update/archive, and - the most
  important cases - an "outsider" account being rejected (404) on every
  one of an org's resources: reading the organization, reading its
  property, creating a property in it via a spoofed `organizationId`,
  patching its property, and archiving its property.
- Duplicate-membership enforcement (`@@unique([userId, organizationId])`)
  is verified at the database/migration level (confirmed during manual
  verification) rather than through an HTTP test, because Phase 2 has no
  invite/join endpoint that could ever attempt to create a second
  membership row for the same user+organization - a test exercising an
  endpoint that doesn't exist would test nothing real.

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

## Roadmap

Phase 0 (done) → Phase 1 (done): platform identity, auth, sessions, KYC
foundation → Phase 2 (this repository, done): organizations + properties +
`OrganizationMembership`-based authorization → Phase 3: rooms + beds →
Phase 4: tenants + bed allocation/residency → Phase 5: rent + invoices →
Phase 6: payments → Phase 7: complaints → Phase 8: food/menu → Phase 9:
notifications → Phase 10: subscriptions/billing.
