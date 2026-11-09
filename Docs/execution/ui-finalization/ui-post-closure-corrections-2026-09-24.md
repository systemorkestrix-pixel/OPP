# UI Post-Closure Corrections — 2026-09-24

Bounded correction pass executed **after** the Phase A closure commit `184a72d`
(`feat: finalize bilingual responsive RTL UI`). Phase A was **not** amended.

Base: `184a72d` · Branch: `main` (no push from this pass)

---

## 1. Observed discrepancies

During direct usage, two real UI discrepancies were reported and reproduced:

| # | Discrepancy | Reproduced |
|---|-------------|------------|
| 1 | Primary create/insert actions visible on **Properties** but apparently missing from other entity pages (Units aside) | ✅ yes — tenants, leases, applications, maintenance, rent showed **no** create affordance on an empty list |
| 2 | **RTL filter/tab controls** — Maintenance filter tabs and Settings tabs did not behave like RTL in Arabic | ✅ yes — the tab strips stayed LTR inside `dir=rtl` pages |

## 2. Root causes

### 2.1 Create actions missing on empty pages — [VERIFIED] regression

Phase A's UI-F6 consolidation moved the "primary create affordance" message into
each page's **header** action slot, but the header button was still gated behind a
list-length guard:

```tsx
// pre-fix (illustrative)
actions={ tenants.length > 0 ? <Button>…tenants.new</Button> : null }
```

When a list is empty (fresh install / empty tenant, lease, charge, work-order,
application data), the button silently disappeared, and the shared `EmptyState`
carries **no** create action either. Result: a page with zero data had **zero**
create affordances — exactly when creating is the primary need. Pages with data
(Properties in the dev DB) showed the button, which is why the report looked like
"Properties only".

Affected pages (all share the same guard pattern):

- `/properties` (guarded on `properties.length > 0`)
- `/tenants` (guarded on `tenants.length > 0`)
- `/leases` (guarded on `leases.length > 0`)
- `/applications` (guarded on `applications.length > 0`)
- `/maintenance` (guarded on `filtered.length > 0` — even an empty **filter** hides create)
- `/rent` ("Generate charges" guarded on `charges.length > 0` — hidden exactly when no charges exist, i.e. when generation is the only path in)

**Intentional, verified-OK (no change):**

- **Units** — "Add unit" is always rendered on the property detail page (`property-page.tsx`).
- **Work orders** — "New work order" always renders on the property detail page.
- **Vendors** — Settings → Vendors tab: "+ Add vendor" always visible.
- **Users** — Settings → Users tab: "+ Add user" always visible for `owner`/`admin`
  (role-gated by product design; the tab itself is hidden for other roles).
- **Payments** — no page-level create by design: payments are recorded per charge
  row in Rent (payment dialog per charge). Interaction model, not a gap.
- **Dashboard** — navigation tiles only; not a create page.

### 2.2 RTL tabs — [VERIFIED] pre-existing defect (not introduced by Phase A)

`src/client/components/ui/tabs.tsx` wraps Radix `@radix-ui/react-tabs`. Radix
renders `dir="ltr"` on the Tabs root by default (`useDirection` defaults to
`ltr`; the document direction is **not** consulted). On Arabic pages
(`<html dir="rtl">`), the whole tab strip therefore rendered LTR:

- tab ordering and active-indicator position followed **left-to-right**;
- arrow-key navigation used LTR semantics (**ArrowRight = next**) even in Arabic.

`ui/tabs.tsx` was **not** modified by Phase A, so this is a pre-existing defect of
the shared component that the bilingual/RTL work surfaced; it affects **every**
tab instance in the app (Maintenance filter tabs, Settings tabs, Leases status
tabs, Applications filter tabs) because they all share the component. The fix is
therefore the smallest shared correction possible: one file.

## 3. Fixes (UI only — no API / DB / business-logic changes)

### 3.1 Create affordances always present — `src/client/components/{properties,tenants,leases,applications,maintenance,rent}/*`

Removed the list-length guards so each page keeps exactly **one** primary create
affordance in the PageShell header at all times (no duplicate CTAs introduced):

| File | Change |
|------|--------|
| `properties/properties-list.tsx` | `properties.length > 0 && <Button>` → always render |
| `tenants/tenants-list.tsx` | `tenants.length > 0 && <Button>` → always render |
| `leases/leases-page.tsx` | `leases.length > 0 ? <Button> : null` → always render |
| `applications/applications-page.tsx` | `applications.length > 0 ? …` → always render |
| `maintenance/maintenance-page.tsx` | `filtered.length > 0 ? …` → always render |
| `rent/rent-page.tsx` | `charges.length > 0 && <Button generate>` → always render |

Labels use existing i18n keys (`properties.new`, `tenants.new`, `leases.new`,
`applications.new`, `maintenance.new`, `rent.generate`) — **no catalog growth**,
FR/EN typography untouched.

### 3.2 Shared RTL direction wiring for tabs — `src/client/components/ui/tabs.tsx`

Added a `useDocumentDirection()` hook (reads `document.documentElement.dir`,
reacts to `dir` attribute changes via `MutationObserver`) and passed `dir` to the
`Tabs`/`TabsList`/`TabsTrigger`/`TabsContent` Radix primitives. Radix now mirrors
the strip and uses RTL arrow-key semantics in Arabic; French (and English) remain
`ltr` exactly as before. All four tab consumers (Maintenance, Settings, Leases,
Applications) are corrected by this one shared change.

## 4. Browser evidence (Playwright, chromium-1234 headless, real app on :5173)

Artifacts: `.playwright-mcp/phaseA-post/{before,after,final}/` (summary.json +
screenshots; directory is git-ignored but on disk).

Locale forced deterministically per pass (direct write into the local D1 file —
see §6); every run's `htmlLang`/`htmlDir` recorded; runs that did not match the
intended locale were rejected, not recorded.

### 4.1 BEFORE (`phaseA-post/before/summary.json`)

**Create action present in page header (BEFORE):**

| route | fr 375/768/1440 | ar 375/768/1440 |
|-------|-----------------|-----------------|
| /properties | true · true · true | true · true · true |
| /tenants | **false** ×3 | **false** ×3 |
| /leases | **false** ×3 | **false** ×3 |
| /applications | **false** ×3 | **false** ×3 |
| /maintenance | **false** ×3 | **false** ×3 |
| /rent | **false** ×3 | **false** ×3 |

Dev DB at the time: properties=3, units=5, vendors=3; tenants/leases/charges/
work_orders/applications = 0 — exactly the "only Properties shows create" report.

**Tabs (BEFORE)** — `htmlLang=ar` pages: `listDir=ltr`, active tab at the left
(e.g. ar-375 /settings activeX=28), keyboard `ArrowRight → 1` (LTR semantics).
French: `listDir=ltr`, activeX small, `ArrowRight → 1` (correct). The defect is
captured cleanly on AR pages.

### 4.2 AFTER / FINAL (`phaseA-post/final/summary.json` + targeted probe)

**Create action present in page header (FINAL):**

| route | fr 375/768/1440 | ar 375/768/1440 |
|-------|-----------------|-----------------|
| /properties | true ×3 | true ×3 |
| /tenants | true ×3 | true ×3 |
| /leases | true ×3 | true ×3 |
| /applications | true ×3 | true ×3 |
| /maintenance | true ×3 (probe: header button "Nouvel ordre de travail") | true ×3 (probe: "أمر عمل جديد") |
| /rent | true ×3 (generate header button) | true ×3 (probe: "توليد الرسوم") |

(The two `N`s reported by the sweep for FR maintenance were detector keyword
misses — the button text "Nouvel ordre de travail" was not in the matcher; a
targeted probe confirmed the button is present with Plus icon at 375 and 1440 in
both locales.)

**Tabs (FINAL):**

| lang | listDir | active tab position | keyboard (ArrowRight from 0) |
|------|---------|---------------------|------------------------------|
| fr-DZ | ltr | left (unchanged) | 0 → 1 (LTR, unchanged) |
| ar | **rtl** | right (375: activeX 264–335 on a 327-wide strip) | 0 → 5 (RTL previous-wrap semantics) |

- Zero page overflow across all 60 + targeted runs (375/768/1440 × FR/AR).
- Zero JS console errors (only the known pre-existing `/tenants/1`-style 404s not
  applicable here; all measured routes clean).
- Settings tabs (vendors/policy/users/audit) mirror correctly in AR; Leases and
  Applications filters too (shared component).

## 5. Tests

- `pnpm typecheck` → exit 0.
- `pnpm vitest run --no-file-parallelism` → **15 files / 216 tests passed, exit 0**
  (run sequentially per the 7.8 GB RAM constraint). No tests weakened or changed
  — the suite is API-level and does not assert the removed guards.
- Pre-existing, non-blocking stderr noise unchanged: `audit write failed: no such
  table: audit_logs` + Node `SQLite` ExperimentalWarning (already documented).

## 6. Environment note — dev-DB locale switching [INFERENCE]

Mid-session, `PUT /api/settings` began returning 200 and echoing the new locale
in its response body while a subsequent fresh read returned the stale value.
Investigation: the running `wrangler dev` worker and the `wrangler d1 execute
--local` CLI both open the same Windows-local D1 SQLite (WAL mode) under
`.wrangler/state/v3/d1`; interleaved cross-process opens made the durable value
flap (the Phase A record already noted "dev DB locale was stale ar" as a dev-DB
wrinkle). **This is a local-environment artifact, not an application defect** —
the served value always matched the file once stable, and the app applies locale
from `GET /api/settings` correctly (Phase A QA proved 33/33, and the FINAL sweep
re-proves it with per-run `htmlLang` assertions). The QA driver therefore forces
locale deterministically by writing the local D1 file directly, then asserts the
rendered `lang`/`dir` per run. No server/API code was changed (out of scope).

## 7. Regression vs. intentional — verdict per item

| Item | Verdict |
|------|---------|
| Create actions hidden on empty lists (6 pages) | **REGRESSION** (Phase A UI-F6 consolidation) → **FIXED** |
| Maintenance "Generate charges" hidden when no charges | **REGRESSION** (same consolidation) → **FIXED** |
| RTL tabs (Maintenance / Settings / Leases / Applications) | **PRE-EXISTING** shared-component defect (Radix default LTR), surfaced by the RTL work → **FIXED** at shared component level |
| Units add (property page), property-page work orders | **INTENTIONAL** — always-on [VERIFIED] |
| Vendors add, Users add | **INTENTIONAL** — always-on; users role-gated by design [VERIFIED] |
| Payments create | **INTENTIONAL** — per-charge interaction model, no page-level create [VERIFIED] |

## 8. Scope guardrails honored

- Changed files: `src/client/components/ui/tabs.tsx` + the six entity pages above.
- **Not touched:** API, database, migrations, business logic, P1–P12, packaging/
  deployment, `node_modules`, prior commits, i18n catalogs, server code,
  tests.
- `184a72d` **not amended**; this pass lands as one new commit **on top** of it.
- Not pushed.

## 9. Remaining known issues

- None introduced by this pass. Unrelated pre-existing observations (unchanged
  from Phase A): dev-DB settings-write flakiness under concurrent local access
  (§6, environment only), vitest stderr noise (§5), and the Cairo-space-glyph
  `document.fonts.check` artifact (documented in the Phase A log — authoritative
  check is with Arabic text).
- Out of scope for this pass (unchanged from Phase A): `Docs/00-README.md` /
  `V1-PHASE-INDEX.md` refresh.

---

## Final status

```
STATUS: PASS
CREATE ACTIONS: FIXED (regression) — all six pages, FR+AR × 375/768/1440 verified
RTL TABS: FIXED (pre-existing shared-component defect) — AR mirrored + RTL keyboard; FR unchanged
TESTS: PASS (typecheck exit 0 · 216/216 vitest exit 0)
BROWSER: PASS (60-run sweep + targeted probes; 0 overflow, 0 console errors)
COMMIT: aab9081 (parent 184a72d; 184a72d not amended)
PUSH: NOT DONE
```