# Execution Log — P6: Charge Administration UI

Records the execution of phase P6 from `Docs/plans/13-v1-implementation-plan.md` (P6 section) and
`Docs/plans/13c-v1-implementation-plan.md` (order step 6). Authored by the execution agent
(systemorkestrix-pixel) on 2026-09-21.

## Status

[COMPLETE] — landed as git commit `95eed69` ("feat: add rent charge administration") on `main`,
2026-09-21 08:20 +0100. Preceded by `901dab0` (P5 auth & roles).

## Objective vs. delivered

Plan objective (13, P6): expose the existing API-only charge powers (edit amount / due date /
status incl. `waived`, notes) — closes the biggest rent-ledger gap (C/M7). Edit action per charge
row; dialog for amount / due date / status (`waived` with confirmation) + notes; warn (not block)
when editing a `paid` charge; `recompute` after edits so `amount_paid`/`status`/totals stay
consistent. No database or API-surface changes (uses the existing `PUT /api/rent-charges/:id`).

Delivered:

- **Server recompute** in `src/server/index.ts`: `PUT /api/rent-charges/:id` now applies the field
  patch then recomputes the financial state from source of truth — `amount_paid = SUM(payments)`,
  status re-derived via `computeChargeStatus` (`open`/`partial`/`paid`) and the overdue rule via
  `isChargeOverdue` against `currentUtcDate()` (matching P1 finance rules); a `waived` charge keeps
  its status and is excluded from auto-recompute, including on later edits without a status.
  Payments are never mutated.
- **Edit dialog** `src/client/components/rent/charge-edit-dialog.tsx` (new): amount, due date,
  status select (the five valid statuses), and notes fields; context card showing property / unit /
  tenant / due / charged / paid-so-far; explicit confirmation dialog before applying `waived`; a
  warning (non-blocking) when the target charge is `paid`.
- **Rent page** `src/client/components/rent/rent-page.tsx`: pencil edit action per charge row,
  `editTarget` state, and `<ChargeEditDialog onSaved={load} />` wired beside the payment dialog.
- **i18n**: `charge_edit.*` keys (title, amount, due_date, status, notes, paid_warning,
  waived_note, waived confirm labels, paid-change warning) added to `en.json`, `fr.json`,
  `ar.json`.
- **Tests**: `tests/charge-admin.test.ts` — 12 tests; full suite 132 tests green.

## Design decisions

- **Reuse, don't duplicate.** The recompute path calls the same pure helpers
  (`computeChargeStatus`, `isChargeOverdue`, `currentUtcDate` in `src/server/finance.ts`) used by
  payment add/remove, so there is exactly one source of financial truth. No second calculation
  system was introduced.
- **Edit is a patch + recompute, never a payment mutation.** `amount_paid` and `status` are always
  derived from `SUM(payments.amount)` after an edit; the payments table is never touched, so edit
  history stays intact.
- **Bug fixed during testing:** the first draft used `parsed.data.due_date ?? ""` when re-checking
  the overdue rule, so an edit that omitted `due_date` compared `""` against today (always
  "overdue"). The recompute now reads the stored `due_date` from the charge row.
- **`waived` is sticky.** Once set, later edits (e.g. amount or notes only) keep `waived` and never
  flip the charge back to overdue — matching the P1 rule that `waived` is excluded from the
  overdue/collection path.
- **Auth behavior follows P5.** Charge mutation is protected by the P5 middleware when
  `AUTH_ENABLED=true` (401 without a session); per the P5 role matrix charge editing is
  operational, so owner/admin/manager all have access — no extra role gate was added.

## Verification evidence

- [VERIFIED] `pnpm typecheck` exits 0 (TYPECHECK_OK).
- [VERIFIED] `pnpm test` runs green: 9 files, 132/132 tests passed (120 from P1–P5 plus 12 new P6
  tests in `tests/charge-admin.test.ts`).
- [VERIFIED] New tests cover the plan's required cases (13, P6 §6) and the recompute rule:
  - post-edit recalc: amount change → `amount_paid`/`status`/totals; partial payment (600/1200 →
    `partial`) then amount reduced to the paid amount → `paid`;
  - `waived` set directly; a past-period charge that is `overdue` stays `waived` after the status
    edit (excluded from overdue);
  - `amount_paid` always derived from payments after amount increase (400/2000 → `partial`);
  - payment history preserved after amount change (two payments kept, `amount_paid` = 800);
  - paid charge stays consistent (`paid`, `amount_paid` = 1200) after a notes-only edit;
  - input handling: nonexistent charge → 404, empty patch → 400;
  - edit succeeds without auth when `AUTH_ENABLED=false` (P6 §6 regression path).
- [VERIFIED] Review verdict from the read-only reviewer: **PASS** — no CRITICAL/HIGH findings.
  MEDIUM/LOW notes recorded non-blocking (lenient `intParam` parsing, no date-format validation,
  no direct `AUTH_ENABLED=true` mutation test — middleware verified by inspection and covered in
  `tests/auth.test.ts`; French `charges abandonnées` wording; UI allows manual `open`/`partial`/
  `paid` choices that the server re-derives anyway).
- [VERIFIED] Git diff audit — changed files are limited to P6 scope (rent page, new edit dialog,
  finance recompute, i18n, tests). `Docs.zip` remains untracked and was never staged.

## Files changed (commit stat)

`src/client/components/rent/charge-edit-dialog.tsx` (new), `tests/charge-admin.test.ts` (new),
`src/server/index.ts`, `src/client/components/rent/rent-page.tsx`,
`src/client/i18n/en.json`, `src/client/i18n/fr.json`, `src/client/i18n/ar.json`. 7 files,
+467/−10.

## Risks / notes

- [INFERENCE] Dialog interactions (paid warning, waived confirmation) were verified through the
  client code and integration coverage; the DOM flows themselves were not exercised by Vitest and
  are covered by the live-app path.
- Rollback per plan P6 §8: revert `95eed69`; endpoints are unchanged so the API surface is
  untouched and only the UI delta is lost.
- This phase closes the C/M7 rent-ledger gap and is a dependency-friendly neighbour of P7–P10
  (order step 6 runs in parallel with P7/P8/P9/P10 per 13c); no P7+ work (work-order completion
  stamp, overdue freshness, lease hardening, Applications UI, CSV export, audit trail, new payment
  methods / accounting / invoices / receipts, new financial entities) was included.
- Note: `Docs.zip` (audit archive) remains untracked in the repo and is never staged.