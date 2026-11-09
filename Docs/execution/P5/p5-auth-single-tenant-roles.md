# Execution Log — P5: Auth & Single-Tenant Roles

Records the execution of phase P5 from `Docs/plans/13-v1-implementation-plan.md` (P5 section) and
`Docs/plans/13c-v1-implementation-plan.md` (order step 5). Authored by the execution agent
(systemorkestrix-pixel) on 2026-09-21.

## Status

[COMPLETE] — landed as git commit `901dab0` ("feat: add single-tenant authentication and roles")
on `main`, 2026-09-20 21:38 +0100. Preceded by `3ae7943` (P4 Algerian localization).

## Objective vs. delivered

Plan objective (13, P5): remove the open-API blocker (R1) with minimal surface — login, session,
roles (`owner` / `admin` / `manager`) for one organization. No multi-tenancy.

Delivered:

- **Auth migration** `migrations/0003_auth_users.sql` (additive): `users(id, email UNIQUE,
  password_hash, display_name, role, created_at)` indexed, plus `sessions(id, user_id FK,
  token_hash UNIQUE, expires_at)`; seed `users` stays opt-in and never in the demo seed.
- **Auth module** `src/server/auth.ts`: PBKDF2-SHA256 password hashing (100k iterations, random
  16-byte salt, iteration/hash-length validation), D1-backed sessions with SHA-256 hashed tokens,
  cookie helpers (HttpOnly, SameSite=Strict, Secure via `X-Forwarded-Proto`), role hierarchy
  (owner > admin > manager), `AUTH_ENABLED` feature flag with 5s cache.
- **Middleware + routes** in `src/server/index.ts`: session-aware auth middleware on `/api/*` with
  an explicit public-route allowlist; `POST /api/auth/login|logout`, `GET /api/auth/session`,
  `POST /api/auth/bootstrap` (atomic `INSERT … WHERE NOT EXISTS`), `GET /api/auth/status`;
  user-management routes (owner/admin): `GET/POST /api/users`, `PUT/DELETE /api/users/:id` with
  role-based guards; settings PUT gated to admin+ when auth enabled.
- **Error codes**: 7 new auth codes added to `src/server/errors.ts`.
- **Client**: login page (`src/client/components/auth/login-page.tsx`), Users tab
  (`src/client/components/settings/users-tab.tsx`), auth flow in `app.tsx` (session check, login
  routing, logout, 401 redirect), `/login` route in `use-router.ts`, `credentials: "include"` +
  `onUnauthorized` in `src/client/api.ts`, auth keys in `en.json` / `fr.json` / `ar.json`.
- **Tests**: `tests/auth.test.ts` — 31 tests; full suite 120 tests green.

## Design decisions

- **Feature-flag middleware (`AUTH_ENABLED`)** with a 5s cache gives the P5 §8 rollback path: when
  disabled the API keeps the current open behavior for one release; `users`/`sessions` tables are
  additive and inert until the flag is on.
- **Atomic bootstrap** (`INSERT … WHERE NOT EXISTS`) prevents the first-owner race exposed in
  review; unknown roles are rejected rather than defaulted so the matrix never silently degrades.
- **Public-route allowlist** replaces prefix matching (`/api/auth/*`, `/api/health`) so no future
  route accidentally inherits public access; auth endpoints carry their own explicit checks.
- **Secure cookie via `X-Forwarded-Proto`** keeps the cookie valid behind the proxy setup used for
  the deployed app; expired sessions are cleaned opportunistically instead of on a timer.
- **No multi-tenancy** and no change to existing resource payloads — per the safe-change rules
  (`Docs/references/10-evolution.md`) the phase only adds auth/user surface and middleware guarding.

## Verification evidence

- [VERIFIED] `pnpm typecheck` exits 0 (TYPECHECK_OK).
- [VERIFIED] `pnpm test` runs green: 9 files, 120/120 tests passed (89 from P1–P4 plus 31 new P5
  tests in `tests/auth.test.ts`).
- [VERIFIED] New tests cover the plan's required cases (13, P5 §6):
  - bootstrap creates the first owner only when no users exist; 409 when users exist;
  - login succeeds with valid credentials, 401 on wrong password; session round-trip; logout
    clears the cookie;
  - user management: list, create (admin+), duplicate-email 409, update, delete (owner only),
    admin cannot delete owner, admin cannot create owner, manager cannot list/create users;
  - password hashing verifies correct passwords and rejects incorrect ones;
  - role hierarchy and middleware reject unauthorized access.
- [VERIFIED] Post-review security fixes all landed in `901dab0` (atomic bootstrap, settings PUT
  admin gate, Secure via X-Forwarded-Proto, explicit allowlist, password-hash validation, unknown
  role rejection, session cleanup, client 401 redirect).
- [VERIFIED] Git diff audit — changed files are limited to P5 scope (auth module, middleware,
  user routes, client auth, i18n, migration, tests). `Docs.zip` remains untracked and was never
  staged.

## Files changed (commit stat)

`migrations/0003_auth_users.sql` (new), `src/server/auth.ts` (new), `src/server/index.ts`,
`src/server/errors.ts`, `src/client/api.ts`, `src/client/app.tsx`,
`src/client/components/auth/login-page.tsx` (new),
`src/client/components/settings/settings-page.tsx`,
`src/client/components/settings/users-tab.tsx` (new), `src/client/hooks/use-router.ts`,
`src/client/i18n/en.json`, `src/client/i18n/fr.json`, `src/client/i18n/ar.json`,
`tests/auth.test.ts` (new). 14 files, +1414/−13.

## Risks / notes

- [INFERENCE] The auth tests exercise the full HTTP surface via the D1 + `app.request()` harness;
  live-app session behavior (cookie handling, 401 redirect on the rendered client) is covered by
  the same code paths through the integration harness.
- Rollback per plan P5 §8: set `AUTH_ENABLED=false` (open behavior for one release) or revert
  `901dab0`; `users`/`sessions` are additive until the flag flips on.
- This phase is a prerequisite for P7 (work-order completion stamp authorization), P11 (period /
  overdue parity with the Rent page) and P12 (audit trail tied to the P5 actor) per 13c
  dependencies.
- Note: `Docs.zip` (audit archive) remains untracked in the repo and is never staged.