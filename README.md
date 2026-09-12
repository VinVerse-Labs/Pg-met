# PG Backend

Backend API for a multi-tenant PG (Paying Guest) management SaaS platform.
NestJS + TypeScript + PostgreSQL (Prisma), built as a modular monolith.

This repository is backend-only. The mobile apps (owner/manager and
student) are separate React Native / Expo projects and are not part of
this codebase.

## Status: Phase 0 - Foundation

What exists today is the production-quality *foundation* the rest of the
product is built on: project setup, configuration, database connectivity,
the core multi-tenant data model, global error handling, health checks and
tooling. It intentionally does **not** yet include auth endpoints, rent,
payments, complaints, food, or student-facing features - those come in
later phases (see "Roadmap" below).

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
└── health/                 # GET /api/v1/health
```

`modules/` (auth, users, organizations, properties, rooms, beds, tenants,
rent, payments, complaints, food, announcements, notifications,
subscriptions) does not exist yet - it is added incrementally, one module
per phase, starting with `auth` in Phase 1. Creating empty module shells
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

## Data model (Phase 0)

```
Organization
├── OrganizationMembership (user + role: OWNER | MANAGER | STAFF | STUDENT)
└── Property
    └── Room
        └── Bed
            └── BedAllocation (history: tenant + bed + start/end + status)

User ──< OrganizationMembership >── Organization
User ──(optional, 1:1)── Tenant
User ──< RefreshToken
```

- `User` is pure identity (phone/email/name/password hash). It has no
  role field - see "Key decisions" above.
- `Tenant` is intentionally separate from `User`: an owner can check a
  tenant in before that person ever creates a login.
- `BedAllocation.status` is `ACTIVE | ENDED | CANCELLED`. Concurrency
  safety for "one bed, one active occupant" is enforced by a partial
  unique index (see "A note on the bed allocation constraint" above), not
  by application code alone.
- `PrismaClientKnownRequestError` (Prisma's own error type, e.g. a unique
  constraint violation) is mapped to the standard error envelope
  automatically by `AllExceptionsFilter` - a future module doesn't need
  its own try/catch for that.

## Roles

Five roles are modeled from day one: `SUPER_ADMIN` (platform-level, on
`User.platformRole`), and `OWNER | MANAGER | STAFF | STUDENT`
(organization-scoped, on `OrganizationMembership.role`). No authorization
guards exist yet - that lands in Phase 1/2 as a small number of
centralized guards, not scattered `if (role === ...)` checks in
controllers.

## Testing strategy

- `src/**/*.spec.ts` - unit tests, run with `npm test`. Currently covers
  `AllExceptionsFilter`, the single place all error responses are
  produced - this is the highest-leverage piece of business/security
  logic that exists in Phase 0.
- `test/*.e2e-spec.ts` - HTTP-level tests, run with `npm run test:e2e`.
  `PrismaService` is overridden with a mock in every e2e test so the
  suite does not require a running database; it verifies routing, the
  global prefix, the `ValidationPipe`, and both response envelopes
  end-to-end.
- Auth, authorization and cross-organization isolation tests are
  deliberately **not** written yet - those modules don't exist until
  Phase 1/2, and a test for code that doesn't exist is a test for
  nothing. They are called out explicitly here so they aren't forgotten
  once that code lands.

## Environment variables

See `.env.example` for the full list. All of them are validated at
startup (`src/config/env.validation.ts`); the app refuses to boot if a
required one is missing or malformed.

## Roadmap

Phase 0 (this repository, done) → Phase 1: auth + users + roles → Phase 2:
organizations + properties + authorization → Phase 3: rooms + beds →
Phase 4: tenants + bed allocation → Phase 5: rent + invoices → Phase 6:
payments → Phase 7: complaints → Phase 8: food/menu → Phase 9:
notifications → Phase 10: subscriptions/billing.
