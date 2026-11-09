# Execution Log — P7: Work-Order Completion Stamp

Records the execution of phase P7 from `Docs/plans/13-v1-implementation-plan.md` (P7 section) and
`Docs/plans/13c-v1-implementation-plan.md` (order step 7). Authored by the execution agent
(systemorkestrix-pixel) on 2026-09-21.

## Status

[COMPLETE] — landed as git commit `b2ae810` ("feat: stamp completed work orders") on `main`,
2026-09-21. Preceded by `95eed69` (P6 charge administration UI).

## Objective vs. delivered

Plan objective (P7): close work orders from the UI and ensure a completed work order receives a
`completed_at` timestamp — the documented R14 / M8 completion-stamp gap. UI dialog handles the
completion timestamp when the user selects `Completed`; the maintenance list displays the
completion date when available; re-edit never clears an existing timestamp; a never-completed
cancelled order never receives one.

Delivered:

- **Server stamp** in `src/server/index.ts` (no new endpoint, no migration, no schema change):
  - `PUT /api/work-orders/:id`: when an edit sets `status = "completed"` and the effective
    `completed_at` is absent (not supplied, or explicitly `null`), stamp `new Date().toISOString()`.
    Re-editing an already-completed order preserves the original timestamp instead of clearing or
    re-stamping it; a non-null explicit `completed_at` is honored; cancelled and other non-completed
    edits never stamp.
  - `POST /api/work-orders`: an order created directly as `completed` without a timestamp receives
    one, keeping the invariant consistent with the edit path.
- **Dialog** `src/client/components/maintenance/work-order-dialog.tsx`: when editing an order that
  already has `completed_at`, a muted "Completed on {date}" line is shown; the dialog never sends
  `completed_at`, so the server owns the stamp.
- **List** `src/client/components/maintenance/maintenance-page.tsx`: card footer renders
  `Completed {date}` whenever `completed_at` is present, and the created-fallback only shows when
  both `scheduled_at` and `completed_at` are absent.
- **i18n**: `maintenance.completed_on`, `work_order.completed_on` added to `en.json`,
  `fr.json` (French parity kept), `ar.json`.
- **Tests**: `tests/work-orders.test.ts` — 12 tests; full suite 144 tests green.

## Design decisions

- **Server owns the timestamp, not the client.** The UI never sends `completed_at`; the server
  stamps on transition to `completed`. This makes the invariant
  `status = completed AND completed_at absent → stamped` hold regardless of caller, and requires no
  client clock/format handling.
- **Preserve, never clear, never re-stamp.** On a completed re-edit the pre-existing timestamp is
  left untouched; an explicit `completed_at: null` is treated as "absent" and stamped, so a
  completed order can never persist without a timestamp (review-HIGH fix).
- **POST parity.** Creating a work order directly as `completed` stamps it too, so the invariant
  holds across both create and update paths, not just edits.
- **Minimal client footprint.** The dialog needs no new field logic — it just displays the date —
  and the list gains one conditional line. `api.ts` and `types.ts` needed no change
  (`updateWorkOrder` already accepts a partial `NewWorkOrder`, which includes `completed_at`).
- **No auth/i18n redesign.** Existing P5 middleware already protects `/api/work-orders/*` when
  `AUTH_ENABLED=true`; P7 adds no role gate. Translations go through the existing `tf()` mechanism.

## Verification evidence

- [VERIFIED] `pnpm typecheck` exits 0 (TYPECHECK_OK).
- [VERIFIED] `pnpm test` runs green: 10 files, 144/144 tests passed (132 from P1–P6 plus 12 new P7
  tests in `tests/work-orders.test.ts`).
- [VERIFIED] New tests cover the acceptance cases (P7 §10) and edge cases:
  - Case A/Test 1 — completing stamps a non-null `completed_at` and persists it (read back equals
    the returned value);
  - Case B/Test 2 — re-editing an already-completed order (status + notes) preserves the original
    timestamp value;
  - Case C/Test 3 — cancelling a never-completed order leaves `completed_at = null`;
  - Test 4 — CRUD regression (create/list/update/delete), 404 for nonexistent id, 400 for empty
    patch;
  - Test 5 — auth regression: 401 on work-order routes when `AUTH_ENABLED=true` without a session;
    mutation succeeds with a valid session cookie;
  - extra: creating directly as `completed` stamps; explicit non-null `completed_at` honored;
    explicit `completed_at: null` on a completed edit still stamps (never leaves a completed order
    without a timestamp); non-completed status edits never stamp.
- [VERIFIED] Review verdict (read-only reviewer, two passes): **PASS** — after the review-HIGH
  (explicit `null` completed_at bypassing the stamp) was fixed and covered by a test, the second
  pass reported no CRITICAL/HIGH/MEDIUM/LOW findings.
- [VERIFIED] Git diff audit: 7 files changed, all P7 scope (`src/server/index.ts`, both maintenance
  components, three i18n catalogs, `tests/work-orders.test.ts`). No endpoint added, no migration,
  no schema modification, no P8+ artifacts. `Docs.zip` (root and `Docs/`) and the P5/P6 execution
  logs were never staged.

## Files changed (commit stat)

`src/server/index.ts`, `src/client/components/maintenance/work-order-dialog.tsx`,
`src/client/components/maintenance/maintenance-page.tsx`, `src/client/i18n/en.json`,
`src/client/i18n/fr.json`, `src/client/i18n/ar.json`, `tests/work-orders.test.ts` (new).
7 files, +252/−5.

## Risks / notes

- [INFERENCE] Dialog/list DOM flows (completion date line on the card) were verified through
  typecheck and the client code; the rendered DOM itself is not exercised by Vitest, which runs the
  server/integration paths via the `app.request()` harness.
- [INFERENCE] The imported timestamp format is an ISO string (`new Date().toISOString()`); an
  explicitly supplied legacy `YYYY-MM-DD HH:MM:SS` value is still accepted and stored as-is (both
  parse through the client's `formatDate`).
- Non-blocking reviewer note (not fixed, MEDIUM class): a previously-completed order later changed
  to `cancelled` retains its timestamp — this satisfies "must not receive a completion timestamp"
  and is not regression-tested; acceptable per the stated requirements.

## Rollback

Revert `b2ae810` (`git revert b2ae810`). The API route is unchanged in shape (same `PUT
/api/work-orders/:id`), requests continue to pass/reject the same fields, and the UI delta
(completion-date line in dialog and list) disappears cleanly. No data or schema migration is
involved; any already-stamped `completed_at` values remain valid and untouched.