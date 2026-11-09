# Execution Log — P8: Overdue Freshness

Records the execution of phase P8 from `Docs/plans/13-v1-implementation-plan.md` (P8 section). Authored by
the execution agent (systemorkestrix-pixel) on 2026-09-21.

## Status

[COMPLETE] — landed as git commit `87c861b` ("feat: refresh overdue status on read") on `main`,
2026-09-21. Preceded by `b2ae810` (P7 work-order completion stamp).

## Objective vs. delivered

Plan objective (P8): the stored `overdue` status of rent charges goes stale the moment time passes a
due date or money moves, and nothing re-asserts it outside generation/edits. Required invariant: for
every non-waived rent charge, when `due_date < current UTC date AND amount_paid < amount`,
`status = "overdue"`, refreshed at read time. No new endpoint, no migration, no schema change, and
only one authoritative overdue rule.

Delivered:

- **Shared `markOverdue()` helper** in `src/server/index.ts` — a single read-path refresh that
  persists `'overdue'` for any `open`/`partial` charge that is past due with an outstanding balance.
  It calls the existing P1 source-of-truth helpers (`currentUtcDate()`, `isChargeOverdue()` from
  `src/server/finance.ts`) verbatim — no second overdue calculation system was introduced.
- **Wired into three call sites:**
  - `GET /api/rent-charges` — refresh runs before the list is queried, so `?status=overdue` and the
    Rent page badge show current state;
  - `GET /api/dashboard/summary` — refresh runs before metrics are computed, so summary and stored
    state can never drift apart (failure is suppressed via `.catch(() => undefined)` to preserve the
    dashboard's pre-existing `safeGet` resilience);
  - `POST /api/rent-charges/generate` — its previous inline copy of the overdue loop was replaced by
    a call to the shared helper (behavior-identical refactor).
- **Guarded persistence (review-HIGH fix):** the update is `UPDATE ... SET status = 'overdue'
  WHERE id = ? AND status IN ('open', 'partial')`. If a concurrent payment commits `paid`/`waived`
  between `markOverdue`'s read and write, the update no-ops instead of overwriting it back to
  `overdue`. Candidate selection (`status IN ('open','partial')`) means paid and waived charges are
  never candidates and an already-`overdue` charge is never re-written — repeated reads are
  harmless.
- **Amount source of truth untouched.** `amount_paid` continues to be derived only from
  `SUM(payments.amount)` in the payment/create/edit recompute paths; `markOverdue` mutates only the
  `status` column.
- **UI**: no changes needed — the Rent page already re-fetches after generate, payment, and charge
  edit (`onSaved={load}`), so fresh server state renders immediately, including the status badge.
  The client-side overdue-display fallback in the Rent page is presentation-only and pre-existing.
- **Tests**: `tests/overdue-freshness.test.ts` (new) — 7 tests; full suite 151 tests green.

## Design decisions

- **Persist the derived status on read, don't just recompute in the response.** The Rent page and
  any `?status=` filter read the stored `status` column; refreshing that column at read time makes
  every consumer (including the dashboard overlap check) agree without new endpoints or contract
  changes.
- **One assistant owns the rule.** `finance.ts` (`isChargeOverdue`, `computeChargeStatus`,
  `currentUtcDate`) is the only place the overdue predicate lives; `markOverdue` only fetches
  candidates, applies the predicate, and writes the outcome.
- **Writes only when observable state actually changes.** The candidate query already excludes
  `overdue`/`paid`/`waived`, so repeated reads never touch already-correct rows; the WHERE guard adds
  concurrency safety rather than extra writes.
- **Dashboard keeps its resilient style.** The dashboard never hard-fails on a mid-flight DB error
  (`safeGet`/`safeQuery`); the `markOverdue` call there mirrors that with a swallow-catch while the
  finance-oriented generate/rent-charges paths keep their existing raw behavior.
- **No contract change.** Response shapes of `GET /api/rent-charges` and
  `GET /api/dashboard/summary` are byte-for-byte the same as before P8.

## Verification evidence

- [VERIFIED] `pnpm typecheck` exits 0 (TYPECHECK_OK).
- [VERIFIED] `pnpm test` runs green: 11 files, 151/151 tests passed (144 from P1–P7 plus 7 new P8
  tests in `tests/overdue-freshness.test.ts`).
- [VERIFIED] New tests cover the P8 §14 acceptance cases:
  - Case A — a stale (past-due, `open`) charge is `overdue` after `GET /api/rent-charges`
    (mid-period due date asserted);
  - Case B — `GET /api/dashboard/summary` refreshes stored overdue state (summary called first, then
    the charge is read back as `overdue`) and the totals reflect it;
  - Case C — a fully paid charge stays `paid` after reads, and the dashboard excludes it (count 0);
  - Case D — a waived charge stays `waived` after reads, dashboard count 0;
  - Case E — repeated reads are idempotent (three reads → `overdue` every time, dashboard count 1);
  - Case F — dashboard `overdue_count` parity with the rent list's `status = 'overdue'` count;
  - Regression — overdue is preserved through a partial payment (payments POST derives `partial`,
    next read re-asserts `overdue`) and an amount edit via `PUT /api/rent-charges/:id`.
- [VERIFIED] Existing P6/P7/charges/dashboard/payments suites still pass unchanged, confirming the
  generate refactor is behavior-identical and paid/waived semantics are intact.
- [VERIFIED] Review verdict (read-only reviewer, two passes): **PASS**. First pass reported one HIGH
  (concurrent payment race could overwrite a just-paid charge back to `overdue`); fixed with the
  guarded WHERE clause; second pass: no CRITICAL/HIGH/MEDIUM findings, only a narrow
  non-blocking LOW (a concurrent due-date edit could still be re-marked `overdue`) and a NIT about
  the dashboard's `.catch(() => undefined)` (matches the existing dashboard resilience pattern).
- [VERIFIED] Git diff audit: 2 files changed, all P8 scope (`src/server/index.ts`, new
  `tests/overdue-freshness.test.ts`). No endpoint added, no migration, no schema modification, no
  i18n changes, no P9+ artifacts. `Docs.zip` (root and `Docs/`) and the P5/P6/P7 execution logs were
  never staged.

## Files changed (commit stat)

`src/server/index.ts`, `tests/overdue-freshness.test.ts` (new). 2 files, +201/−9. Commit `87c861b`.

## Risks / notes

- [INFERENCE] The guarded update closes the paid/waived overwrite race; a concurrent edit that moves
  a charge's due date into the future while its status is still `open` could, in a narrow window, be
  re-marked `overdue` before the next recompute. Review-classified LOW, non-blocking, and not
  reachable through the payment/paid/waived flows the invariant protects.
- [INFERENCE] The dashboard computes its overdue totals from raw fields
  (`due_date < date('now') AND amount_paid < amount AND status != 'waived'`) rather than the stored
  status column; `markOverdue` makes the stored column agree with that computation, and the parity
  test asserts they match.
- The `overdue` status remains manually selectable via `PUT /api/rent-charges/:id`; the existing
  recompute in that route continues to normalize any such manual value against the payment-sum
  business rules.

## Rollback

Revert `87c861b` (`git revert 87c861b`). The restore removes `markOverdue` and its three call sites
(`GET /api/rent-charges`, `GET /api/dashboard/summary`, `POST /api/rent-charges/generate` — the last
returning to its inline loop) plus the new test file. API shapes are unchanged, so clients are
unaffected; already-persisted `overdue` statuses remain valid (overdue was never itself the
authoritative rule — raw fields are), and no data or schema migration is involved.