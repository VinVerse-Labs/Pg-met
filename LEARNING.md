# Learning Log — Running pg-backend Locally

This file is a personal learning record of the "run the backend" session so the
setup doesn't stay locked inside an AI chat. Read it top to bottom once, then
try to redo the steps yourself without asking the assistant.

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
