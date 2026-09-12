# Learning Log — pg-backend

This file is a personal learning record of working sessions on this repo, so
the reasoning doesn't stay locked inside an AI chat. It's organized as one
part per session. Read a part top to bottom once, then try to redo the steps
yourself without asking the assistant.

- **Part 1** — first-time local setup (Docker, Postgres, running the server).
- **Part 2** — implementing Phase 1 (platform identity, auth, sessions, KYC
  foundation) on top of that running backend.

---

# Part 1 — Running pg-backend locally for the first time

---

## 1. What I actually typed

| # | Prompt (verbatim) | Problem with it |
|---|---|---|
| 1 | `run the backned` | Typo aside, it gives no context: which project, is a DB expected to be running, should it install missing tools automatically? The assistant had to guess and ask. |
| 2 | `run the project , now i installed docker` | Better — tells the assistant a precondition changed. Still doesn't say *what* "run" means to you (dev watch mode? one-off smoke test? production build?). |

### A more optimized prompt for this task

```
Run the pg-backend NestJS app in dev mode. Assume Postgres may not be running —
start it via docker-compose if needed, run any pending Prisma migrations, then
start the server and confirm the /api/v1/health endpoint returns 200.
If a required tool (Docker, etc.) is missing, tell me instead of installing it
silently, since installing software is a system-level change I want to approve.
```

Why this is better:
- Names the exact command target (dev mode, not prod build).
- States the expected sequence (DB → migrate → start → verify), so you get a
  health-check confirmation instead of just "server started" logs.
- Explicitly sets the approval boundary for installing new software — this is
  what a good prompt does: it encodes *your* risk tolerance instead of leaving
  the assistant to guess it turn by turn.

General pattern to reuse for *any* "run my app" prompt:
```
Run <app> in <mode>. Dependencies it needs: <list, or "figure it out">.
Definition of "working": <one concrete, checkable thing — an endpoint, an
exit code, an output line>.
Ask me before: <destructive or system-level actions>.
```

---

## 2. What actually happened, step by step

1. **Checked for a project-specific `run` skill first** (`.claude/skills/`) —
   none existed, so fell back to generic "how do I run a NestJS + Prisma app"
   knowledge.
2. **Read `package.json` scripts** — found `start:dev` (nest watch mode),
   `prisma:migrate:dev`, `prisma:generate`.
3. **Read `.env` and `docker-compose.yml`** — found `DATABASE_URL` expects
   Postgres on `localhost:5432`.
4. **Tried starting the app anyway** — it compiled with 0 errors, but crashed
   on boot with:
   ```
   PrismaClientInitializationError: Can't reach database server at localhost:5432
   ```
   This told us the app itself was fine; only its *dependency* was missing.
5. **Checked whether Docker was installed** (`docker --version`) — it wasn't.
6. **Installed Docker Desktop via `winget`** — first attempt failed silently
   because winget needed to elevate (UAC prompt), and a non-interactive shell
   can't click "Yes" on a UAC dialog. Had to hand that step back to you to run
   in an elevated PowerShell window yourself.
7. **You installed Docker and started Docker Desktop manually** — confirmed
   with `docker ps` that the daemon was now reachable.
8. **`docker compose up -d`** — pulled the `postgres:16-alpine` image and
   started a container. It came up but the healthcheck stayed `unhealthy`.
9. **Read the container logs** (`docker logs pg-backend-postgres`) — found the
   real bug:
   ```
   initdb: error: superuser name "pg_backend" is disallowed; role names cannot begin with "pg_"
   ```
   Postgres reserves the `pg_` prefix for its own internal roles/schemas, so
   `POSTGRES_USER: pg_backend` in `docker-compose.yml` was invalid from day
   one — it just hadn't been run against a real Postgres init before.
10. **Fixed it**: renamed the DB user to `pgbackend` (no underscore after
    `pg`) in `docker-compose.yml`, `.env`, and `.env.example`. Left the DB
    name (`pg_backend`) alone since only *role* names hit that restriction.
11. **`docker compose down -v` then `up -d` again** — needed `-v` to drop the
    old volume, because the first `initdb` had failed partway and left a
    broken data directory behind. Reusing that volume with the fixed
    credentials would not have retroactively fixed anything.
12. **`npm run prisma:migrate:dev -- --name init`** — created and applied the
    first migration, generated the Prisma client.
13. **`npm run start:dev`** — this time it logged
    `PrismaService: Connected to the database` and
    `Nest application successfully started`.
14. **`curl http://localhost:3000/api/v1/health`** — got back
    `{"status":"ok","info":{"database":{"status":"up"}}}`, which is the actual
    proof the whole stack (app + DB + migrations) works, not just that a
    process didn't crash.

---

## 3. Issues hit, and the underlying cause

| Issue | Root cause | Fix |
|---|---|---|
| App crashed on boot with a Prisma connection error | `PrismaService` connects to the DB eagerly in `onModuleInit` — there is no lazy-connect mode by default | Get a real Postgres reachable before starting the app |
| `docker` not found | Docker Desktop was never installed on this machine | Installed via `winget install -e --id Docker.DockerDesktop` |
| `winget install` failed with exit code 1 | The installer needs an elevated (Administrator) process; a background shell can't answer a UAC prompt | Ran the same winget command from an elevated PowerShell manually |
| `docker ps` failed with an `npipe` error right after install | Docker Desktop's engine wasn't started yet — installing the app isn't the same as the daemon running | Launched Docker Desktop from the Start menu and waited for the tray icon |
| Postgres container stuck `unhealthy` | `POSTGRES_USER: pg_backend` — Postgres forbids role names starting with `pg_` | Renamed the role to `pgbackend` everywhere it's referenced |
| Renaming the user alone wasn't enough | The failed `initdb` had already partially written a data volume | `docker compose down -v` to drop the volume before recreating |

---

## 4. Things worth remembering (not just for this repo)

- **"Installed" ≠ "running."** A CLI reporting a version, or a package
  manager reporting success, doesn't mean the *service* is up. Always check
  the actual daemon/socket (`docker ps`, a port check, a health endpoint) —
  not just that the install command exited 0.
- **Read container logs before assuming the app is broken.** The Nest app's
  own error message ("can't reach database") was accurate but one layer removed
  from the real bug — the container was never healthy in the first place. The
  next diagnostic step down the stack (`docker logs`) had the real error.
- **Postgres reserves the `pg_` prefix** for its own catalog/roles. Don't name
  application roles, schemas, or anything starting with `pg_` — it's not a
  style guideline, it's rejected outright by `initdb`.
- **A failed first-time container init can poison the named volume.** If a
  container never got healthy on its first boot, don't just fix the config
  and restart it — remove the volume too (`docker compose down -v`), or you
  restart a half-initialized data directory.
- **`nest start --watch` recompiles on save but does not always show a crash
  banner immediately** — tail the actual process output, don't rely on "no
  new errors printed" as a proxy for "still running."
- **A health endpoint that checks the DB (`@nestjs/terminus`) is a much
  better "it works" signal than "server started" log lines** — the latter can
  print before a DB connection ever resolves in some setups.
- **Elevation (UAC) can't be satisfied from a non-interactive/background
  shell.** Anything that needs Administrator rights on Windows has to be
  handed back to a human running an elevated terminal.

---

## 5. Questions an interviewer could reasonably ask from this exercise

- Why did Postgres refuse to start with `initdb: error: superuser name
  "pg_backend" is disallowed`? What's special about the `pg_` prefix in
  Postgres?
- What's the difference between a Docker container being "created," "running,"
  and "healthy" — and what mechanism (`HEALTHCHECK` in the Dockerfile /
  compose file) reports that third state?
- Why did fixing `POSTGRES_USER` alone not fix the container — what does
  `docker compose down -v` remove that a plain `down`/`up` doesn't?
- Where in a NestJS app's lifecycle does `PrismaService.onModuleInit` run,
  and why does a DB outage surface as a crash at that point instead of later,
  on the first request?
- What's the practical difference between `prisma migrate dev` and
  `prisma generate`, and why does `migrate dev` run generate for you
  automatically?
- Why can't a background/non-interactive process click through a Windows UAC
  prompt, and what are the alternatives (manifest to always-elevate, a
  pre-elevated shell, a scheduled task running as SYSTEM)?
- What would you check, in order, if `curl localhost:3000/api/v1/health`
  timed out instead of erroring immediately? (port bound but no listener vs.
  firewall vs. app hung vs. wrong port)

---

## 6. Try it yourself (no AI) — a checklist

- [ ] `docker ps` — confirm Docker Desktop's engine is running
- [ ] `docker compose up -d` — start Postgres, then `docker compose ps` to
      confirm the container is `healthy`, not just `running`
- [ ] `docker logs <container>` — read the last 20 lines even when it *looks*
      fine, so you know what a healthy boot log looks like
- [ ] `npm run prisma:migrate:dev` — apply schema migrations
- [ ] `npm run start:dev` — start the app in watch mode
- [ ] `curl http://localhost:3000/api/v1/health` — the actual proof it works
- [ ] Intentionally break something (stop the Postgres container, then hit
      the health endpoint again) to see what a *failed* health check response
      looks like, so you recognize it next time without guessing

---

# Part 2 — Implementing Phase 1 (auth, identity, sessions, KYC foundation)

## 1. What was actually typed

The prompt for this session was a long, structured spec (~35 numbered
sections) rather than a one-liner. That is worth calling out on its own,
because it is the single biggest difference from Part 1's `run the backned`:

| Style | Example | Effect |
|---|---|---|
| One-liner | `run the backned` | Assistant has to guess mode, scope, and approval boundaries; multiple round trips needed. |
| Long structured spec | The Phase 1 prompt used here | Assistant can work almost the whole session without asking a single clarifying question. |

### Why the long spec worked so well (and what made it good)

It is easy to assume "just describe the feature" is enough. What actually
made this prompt effective was that it did five distinct jobs at once,
each of which removes a category of back-and-forth:

1. **Named the business invariant first, with a concrete example.**
   "A person is a platform user, not a PG" plus the Rahul/ABC-PG/XYZ-PG
   walkthrough gave one sentence to check every later decision against.
   Any time an implementation choice was ambiguous (e.g. "should logout
   affect other devices?"), the invariant plus the worked example
   answered it without needing to ask.
2. **Explicitly listed what NOT to build.** "Do not implement PG
   properties/rooms/beds/residency/rent/... yet" and "do not put
   propertyId/roomId/bedId on User" prevented scope creep in both
   directions — no missing must-haves, no accidental extra work.
3. **Enumerated edge cases up front** (26 of them) instead of leaving them
   to be discovered by testing later. This turned "write good tests" from
   a vague instruction into a checklist that could be verified item by
   item.
4. **Specified the verification bar, not just the feature.** "Do not claim
   anything is complete until it has been tested," plus a numbered
   verification procedure (validate → migrate → typecheck → lint → test →
   boot → Swagger → manual curl), meant "done" had an unambiguous
   definition instead of being a judgment call.
5. **Set an explicit stop boundary.** "Do NOT proceed to Phase 2" prevented
   the single most common failure mode of long autonomous sessions:
   scope creep past the point the human actually wanted to review.

### A more optimized version of "just describe the feature"

If you *didn't* want to write 35 sections by hand, the compressed version
that keeps most of the value looks like this:

```
Implement <feature>. Core invariant: <one sentence + one concrete example
that would falsify a wrong design>.
Explicitly out of scope right now: <list>.
Do not put <specific fields/columns> on <specific model> - <why>.
Edge cases you must handle: <bullet list, even a rough one>.
Definition of done: migrations applied, typecheck/lint/tests all green,
app boots, and you've manually exercised the happy path + at least one
failure path per endpoint. Do not say "complete" if any of those fail.
Stop after this feature - do not start on <next thing> without checking in.
```

The pattern generalizes: **invariant + explicit non-goals + edge case list
+ concrete definition-of-done + explicit stop boundary** is what turns a
long autonomous session productive instead of one that drifts or asks too
many questions.

---

## 2. What actually happened, step by step

1. **Inspected Phase 0 before writing anything** (per the spec's own
   instruction to do this first): read `prisma/schema.prisma`,
   `app.module.ts`, `main.ts`, `config/`, and every file under `common/`
   and `database/`.
2. **Found Phase 0 had already anticipated most of Phase 1**: `User` and
   `RefreshToken` models already existed with the right shape,
   `@nestjs/jwt`/`passport-jwt`/`argon2` were already installed but unused,
   and `ErrorCode` already reserved `INVALID_CREDENTIALS`/`TOKEN_EXPIRED`/
   etc. "Inspect before implementing" turned a would-be schema redesign
   into a much smaller extension.
3. **Extended, not rewrote, `RefreshToken`** (added `lastUsedAt`,
   `userAgent`, `ipAddress`) rather than renaming it to "RefreshSession"
   as the spec's own wording suggested — the spec itself says "do not
   rewrite working Phase 0 infrastructure unnecessarily," so a same-shape
   extension was the more literal reading of the instructions.
4. **Added the `IdentityVerification` model + 2 enums**, deliberately with
   no HTTP endpoints — the spec explicitly separates "build the KYC
   *domain*" from "build the KYC *flow*," and the flow doesn't exist until
   a later phase.
5. **Ran the migration while the dev server from Part 1 was still
   running** — `prisma generate` failed with
   `EPERM: operation not permitted, rename ... query_engine-windows.dll.node`
   because the running Nest process still had the old query engine DLL
   loaded. Had to `TaskStop` the dev server (and separately kill lingering
   `node` child processes `nest start --watch` had spawned, which survived
   the parent being stopped) before `prisma generate` could overwrite the
   file.
6. **Built `users`, `identity-verification`, and `auth` modules** following
   Phase 0's existing conventions (module/service/dto folder shape, the
   `AppException`/`ErrorCode` pattern, `RawResponse`/response envelope) —
   deliberately not introducing a different structure even though the
   spec's own suggested tree (`controllers/`, `services/`, `guards/`, ...)
   was slightly different from Phase 0's flatter `common/` layout.
7. **Typechecked and linted before writing any tests** — caught one real
   type error (`AuthenticatedUser.status` was typed as `string` instead of
   the Prisma `UserStatus` enum) and one lint error (an unused guard
   parameter) immediately, before they could hide inside test mocks.
8. **Wrote unit tests first** (`AuthService`, `TokenService`,
   `IdentityVerificationService`, normalization helpers) — 48 tests,
   covering the specific edge cases the spec enumerated (wrong password,
   nonexistent account, suspended, inactive, expired/invalid/revoked
   refresh token, reuse detection, concurrent-refresh race, idempotent
   logout, invalid KYC state transitions).
9. **Wrote one e2e test** (`test/auth.e2e-spec.ts`) using an in-memory fake
   `PrismaService` (same pattern Phase 0's `health.e2e-spec.ts` already
   used) to exercise the real HTTP stack — register → duplicate (409) →
   login (401 generic for both wrong-password and no-such-account) →
   `/me` (401 no-token / 401 garbage-token / 200 valid) → refresh rotation
   → reuse detection → logout — without needing a real database in CI.
10. **Started the real server and ran the same flow again with `curl`**
    against the actual Postgres database, specifically to confirm reuse
    detection really does cascade (using the *second*, freshly-rotated
    refresh token after the first was replayed, and confirming it too was
    now dead) — a behavior that's easy to get subtly wrong in mocks but
    obviously right or wrong against the real thing.
11. **Verified Swagger** via `/api/docs-json` (fetched with `curl` + a
    one-line Node script, rather than eyeballing the UI) to confirm all 5
    auth routes and their DTOs were registered.
12. **Updated `README.md`** with the architecture explanation the spec
    asked for (token lifecycles, rotation, multi-device sessions, the
    User → IdentityVerification → PGApplication → Residency separation)
    *before* declaring the phase done — documentation was treated as part
    of "done," not an afterthought.

---

## 3. Issues hit, and the underlying cause

| Issue | Root cause | Fix |
|---|---|---|
| `tsc` error: `AuthenticatedUser.status` not assignable to `UserResponseDto.status` | `status` was typed as plain `string` in the strategy instead of reusing Prisma's `UserStatus` enum | Imported `UserStatus` from `@prisma/client` and used it in the interface |
| ESLint error: unused `_context` parameter | Copied a 4-arg `handleRequest` override signature from a passport example without needing the last parameter | Removed the parameter — TypeScript allows a narrower override with fewer params |
| `prisma generate` failed with `EPERM ... rename ... query_engine-windows.dll.node` | The Nest dev server from the previous session was still running (and had spawned child `node` processes that outlived `TaskStop` on the parent) and had the native query engine DLL memory-mapped/locked on Windows | Stopped the dev server, then found and killed the lingering `node` PIDs directly before regenerating |
| Needed to decide how "session family" grouping works for refresh-token reuse detection, with no explicit family column in the spec's suggested schema | The spec asks for reuse detection but doesn't mandate a session-family id | Grouped by `userId` instead (revoke every active session for that user on reuse) — simpler, and documented as a deliberate simplification rather than silently deciding it |
| Concurrent refresh requests for the same token could both succeed and both mint a new token if not handled carefully | A naive "revoke then create" isn't atomic against a second request reading the row before the first revokes it | Used a conditional `updateMany({ where: { id, revokedAt: null } })` inside a `$transaction` as a compare-and-swap — only one concurrent caller can ever see `count === 1` |

---

## 4. Things worth remembering (not just for this repo)

- **A prompt that states the invariant + non-goals + edge cases + a
  concrete "done" bar removes almost all need for clarifying questions** —
  compare this session (zero clarifying questions asked) to Part 1's
  `run the backned` (multiple round trips needed). The cost of writing
  the longer prompt is paid once; the savings compound over the whole
  session.
- **"Inspect before implementing" is not busywork.** Reading Phase 0's
  schema first turned what could have been a full auth-system build into
  "extend two fields and add one new table," because most of the hard
  design decisions (User has no role field, RefreshToken already exists,
  ErrorCode already reserved auth codes) had already been made correctly.
- **A locked native binary is a real, recurring Windows/Prisma failure
  mode.** Any time `prisma generate` needs to happen, check whether a
  running dev server (or, on Windows specifically, an orphaned child
  process the watcher spawned) is still holding the query engine DLL open.
- **Type the "safe user" shape once, from the source enum** (`UserStatus`
  from `@prisma/client`), and reuse it everywhere (JWT strategy, DTOs,
  response types) instead of re-declaring it as `string` in a new spot —
  that mismatch is exactly the kind of bug `tsc` catches for free if you
  run it before writing tests, and exactly the kind that slips through if
  you only run tests (a mock would have happily accepted a plain string).
- **Reuse detection needs a grouping strategy, and "no explicit family
  column" is a valid, simpler choice** — as long as it's written down as a
  decision (see the README's "Refresh token lifecycle & rotation"
  section) rather than left implicit for someone to reverse-engineer
  later.
- **Compare-and-swap (a conditional `updateMany` inside a transaction), not
  "read then write," is the correct pattern for any state transition that
  must not double-fire under concurrent requests.** This generalizes far
  beyond refresh tokens — it's the same shape as an idempotent payment
  capture, a one-time coupon redemption, or a job queue's "claim the next
  row" step.
- **Verifying the same flow twice — once with a fast in-memory fake in
  e2e tests, once with `curl` against the real database — catches
  different classes of bugs.** The e2e test proves the routing/guards/DTO
  wiring is correct fast and repeatably; the manual curl pass proves the
  *real* Postgres unique constraints, real Argon2 timing, and real JWT
  signing all actually agree with what the mocks assumed.

---

## 5. Questions an interviewer could reasonably ask from this exercise

- Why does the JWT payload contain only `{ sub: userId }`? What could go
  wrong if you put the user's role or KYC status directly in the token?
- Why is the refresh token's *hash* stored instead of the token itself,
  and why is a fast hash (SHA-256) fine there when a slow hash (Argon2) is
  required for passwords? What's the actual difference in the threat
  model?
- Walk through exactly what happens, step by step, if a refresh token is
  stolen and used by an attacker *before* the legitimate user's next
  refresh call. What happens if the legitimate user refreshes first
  instead?
- Why is a conditional `updateMany` inside a transaction safer than a
  plain `findUnique` followed by an `update` for implementing refresh
  token rotation? What specific interleaving of two concurrent requests
  would break the naive version?
- Why does login return the exact same error for "account doesn't exist"
  and "wrong password," but a *different*, more specific error for
  "correct password, but the account is suspended"? Why isn't that second
  case also an enumeration risk?
- Why does `IdentityVerification` live in its own table instead of a
  `kycVerified: boolean` on `User`? What real-world requirement (a user
  reusing verification across two PGs, or a PG requiring extra
  verification) would that boolean design fail to support?
- What specifically would need to change in this codebase to add
  "log out from all devices," and why does the existing schema already
  support it without a migration?
- Why did the session hit an `EPERM` error on `prisma generate`, and what
  does that reveal about how a native Prisma query engine binary is
  loaded into a running Node process on Windows?

---

## 6. Try it yourself (no AI) — a checklist

- [ ] Read `prisma/schema.prisma` end to end *before* touching it, and
      write down (even mentally) which Phase 0 pieces you can reuse
      as-is vs. need to extend vs. are missing entirely
- [ ] Add the `IdentityVerification` model + enums yourself, then run
      `npx prisma validate` and `npx prisma migrate dev --name <x>`
- [ ] Implement `register`/`login` first without refresh tokens at all —
      get a single access token working end to end, verified with `curl`
- [ ] Add `RefreshToken` issuance on login, storing only a hash of the
      token (pick a hash function and justify the choice out loud)
- [ ] Implement `/auth/refresh` *without* rotation first (just verify and
      reissue an access token) — notice why that alone doesn't let you
      ever revoke a compromised refresh token
- [ ] Now add rotation: revoke the old row, issue a new one. Try to break
      it by firing two refresh requests with the same token at once
      (`curl` twice in quick succession, or a tiny script) and see what
      happens *before* adding the compare-and-swap guard
- [ ] Add the compare-and-swap guard and confirm the double-fire is gone
- [ ] Simulate stolen-token reuse yourself: log in, refresh once, then
      replay the *original* (now-rotated-away) refresh token, and confirm
      every other session for that user also stops working afterward
