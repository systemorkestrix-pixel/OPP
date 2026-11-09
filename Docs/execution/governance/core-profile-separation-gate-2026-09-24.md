# Architecture Gate — Core / Profile Separation (2026-09-24)

**Gate type**: read-only architecture audit. **No implementation authorized.**
**Scope**: determine whether the current repository can be cleanly separated into
GLOBAL CORE + MARKET PROFILE + JURISDICTION (where applicable) + DEPLOYMENT, with the
intended result `Global Property Core + Algeria Profile = Current Product`.

---

## 0. Baseline & audit scope

- HEAD: `aab9081` — "fix: correct post-closure UI regressions". [VERIFIED — git log]
- Working tree contains unstaged modifications that existed before this gate and were
  **not touched** by this audit: `Docs/execution/ui-finalization/*.md`, `src/server/index.ts`
  (AUDIT_DEFAULT_LIMIT / AUDIT_MAX_LIMIT exported→const, 4 lines), `tests/audit.test.ts`,
  plus untracked `Docs.zip`, `Docs/Docs.zip`, `Docs/execution/P5–P8/`, `tc.txt`, `tc3.txt`,
  `vt.txt`, `vt3.txt`. [VERIFIED — git status]
- The uncommitted `src/server/index.ts` diff is cosmetic (module-scope consts) and does not
  affect any classification in this report. [VERIFIED — git diff]
- All evidence below is from the actual working-tree files at audit time.

---

## 1. Executive conclusion

**The system is separable. The seam count is small, precisely enumerable, and no
core business rule currently depends on Algeria-specific data.**

Everything that makes the product "Algerian" resolves to **five concrete islands**:

1. **Geography data & shape** — `src/client/lib/wilayas.ts` (58 wilayas), the
   `country/wilaya/commune` columns (migration `0002`), the `DZ` default in the property
   dialog, and the geo fields in the server schema/CSV export.
2. **Market defaults** — `DZD` + `fr-DZ` in `DEFAULT_SETTINGS` on **both** server
   (`src/server/index.ts`) and client (`src/client/hooks/use-app-state.ts`), plus the `DZD`
   fallback inside `formatMoney`.
3. **Locale catalog content & registration** — `ar.json`, `fr.json` (served as `fr-DZ`),
   `en.json`, and the hard-coded locale union `"en" | "ar" | "fr-DZ"` in the i18n registry,
   plus the RTL `dir` rule keyed on `settings.locale === "ar"`.
4. **Profile-shaped UI** — the wilaya/commune fields and `DZ` default in
   `property-dialog.tsx`; the hard-coded `en / fr-DZ / ar` locale picker and the `|| "DZD"`
   clamp in `settings-page.tsx`.
5. **Product/deploy shell** — `index.html` (`lang="fr"`, French meta "pour l'Algérie",
   Cairo font, brand identity per `Docs/current/14-brand-architecture.md`).

All **business rules** (rent planning, due-day clamping, charge status, overdue detection,
lease overlap, occupancy reconciliation, payments, audit) are **already pure and
market-agnostic** — `finance.ts` and `leases.ts` contain zero country/currency/locale
references. [VERIFIED]

The **Jurisdiction layer is currently empty**: no Algeria-specific legal/regulatory rule is
implemented anywhere in the codebase. [VERIFIED — grep for jurisdiction markers returned
nothing]

**Verdict: GO** (with preconditions) — see §12. The unknowns blocking a clean split are
governance/brand decisions (what is "core" vs "profile" for the English catalog, the US demo
seed, and the deployed shell identity), not architectural capacity.

---

## 2. Core inventory (GLOBAL CORE — no market dependency)

Classified from the observed code. Each entry: file → symbol/section → dependency →
evidence → classification reason.

### 2.1 Server rules (pure, market-agnostic) — CORE

| File | Symbol / section | Dependency | Evidence | Reason |
|---|---|---|---|---|
| `src/server/finance.ts` | `clampDueDay`, `formatDueDay`, `computeDueDate`, `planChargeGeneration`, `computeChargeStatus`, `isChargeOverdue`, `currentUtcDate` | none (pure) | Whole file; no `DZD`, `fr-DZ`, `wilaya`, `country` tokens | Rent/billing rules are calendar-generic; only input is lease data. [VERIFIED] |
| `src/server/leases.ts` | `dateRangesOverlap`, `leaseClaimsUnit`, `reconcileUnitStatus` | none (pure) | Whole file | Occupancy/conflict rules are market-agnostic. [VERIFIED] |
| `src/server/auth.ts` | PBKDF2, sessions, cookies, `ROLE_HIERARCHY`, `hasMinimumRole`, `isAuthEnabled` | `settings` table (`AUTH_ENABLED`), `@clawnify/db` | Lines 1–185 | Auth/roles/flag mechanism is generic; the flag is a settings row, not a market value. [VERIFIED] |
| `src/server/db.ts` | `initDB/query/get/run` passthrough | `@clawnify/db` | single line | Infrastructure. [VERIFIED] |
| `src/server/migrate.ts` | versioned runner, `BASE_VERSION="0001"` | none | Whole file | Generic DDL runner over `schema_migrations`. [VERIFIED] |
| `src/server/schema.sql` | baseline tables: settings, properties (US 4-field address only), units, tenants, leases, lease_tenants, rent_charges, payments, vendors, work_orders, applications | none | Lines 1–170; **no** country/wilaya/commune columns | Baseline data model is generic; Algeria shape arrives only via migration 0002. [VERIFIED] |
| `migrations/0003_auth_users.sql`, `0004_lease_unit_occupancy.sql`, `0005_audit_logs.sql` | auth, occupancy, audit migrations | none | File set | Additive, generic. [VERIFIED] |
| `src/server/index.ts` | auth routes, units, tenants, leases, lease_tenants, rent charges & payments, work orders, applications, dashboard, reconciliation, users, settings API, CSV infra (`csvCell`, `csvNumber`, `csvResponse`) | `finance.ts`, `leases.ts`, `auth.ts`, `@clawnify/db` | Lines 37–1320, 1522–1650 | API surface is market-agnostic except the enumerated profile seams in §3/§6. [VERIFIED] |

### 2.2 Client core — CORE

| File | Symbol / section | Dependency | Evidence | Reason |
|---|---|---|---|---|
| `src/client/api.ts` | `api()` fetch wrapper, `setOnUnauthorized` | none | Whole file | Transport. [VERIFIED] |
| `src/client/context.tsx` | `AppContext`, `useApp` | hooks/use-app-state | Whole file | DI plumbing. [VERIFIED] |
| `src/client/main.tsx` | entry render | app.tsx, styles.css | Whole file | Bootstrap. [VERIFIED] |
| `src/client/app.tsx` | nav groups, routing, session gate, page switch | i18n `t`, @clawnify/app/client | Lines 32–201 | Generic app shell; localized via the i18n mechanism, not hard-coded market data. [VERIFIED] |
| `src/client/hooks/use-router.ts` | route parsing | none | Whole file | Router. [VERIFIED] |
| `src/client/hooks/use-app-state.ts` | state collection, mutations, settings parsing | api.ts, i18n `setLocale` | **except** `DEFAULT_SETTINGS` (DZD/fr-DZ) and the `dir`/RTL effect — see §3.3, §3.4 | Generic data plumbing; the market-specific parts are isolated to two seams. [VERIFIED] |
| `src/client/lib/utils.ts` | `cn`, `colorPalette`, `colorClasses`, `formatDate`, `formatMoney`, `toIsoDate`, `currentPeriod`, `addMonths`, `formatPeriod`, `daysBetween` | i18n | **except** `formatMoney` DZD fallback and the French `dd/MM/yyyy` branch — see §3.3 | Formatting utilities are locale-driven via `Intl`; only two branches carry profile values. [VERIFIED] |
| `src/client/types.ts` | all entity interfaces | — | **except** `Property.country/wilaya/commune` (lines 13–15) | Entity types are generic; the geo trio is profile-shaped. [VERIFIED] |
| `src/client/i18n/index.ts` | `t`, `tf`, `resolveErrorMessage`, fallback logic, `setLocale` | `en/ar/fr.json` | Whole file | The lookup *mechanism* is core; the catalog set and locale union are profile — see §3.5. [VERIFIED] |
| `src/client/components/` (all except `properties/property-dialog.tsx`, `settings/settings-page.tsx` policy tab) | dashboard, tenants, leases, rent, maintenance, applications, auth, ui primitives | i18n, utils | Directory-wide | No market data imported outside the two seams. [VERIFIED] |
| `src/client/styles.css` | base tokens, layout | — | **except** `[dir=rtl]`/`[lang=ar]`/Cairo blocks — see §3.6 | Base styling is direction-agnostic; RTL rules are profile. [VERIFIED] |

### 2.3 Tests (core-scoped)

`tests/finance.test.ts`, `tests/lease-occupancy.test.ts`, `tests/migrations.test.ts`,
`tests/auth.test.ts`, `tests/work-orders.test.ts`, `tests/applications.test.ts`,
`tests/dashboard.test.ts`, `tests/charge-admin.test.ts`, `tests/overdue-freshness.test.ts`,
`tests/payments.test.ts` — no market values. [VERIFIED — grep]

---

## 3. Algeria / Profile inventory

| File | Symbol / section | Dependency | Evidence | Reason |
|---|---|---|---|---|
| `src/client/lib/wilayas.ts` | `WILAYAS` (58 entries), `Wilaya` interface | none | Lines 1–68; header comment "The 58 wilayas of Algeria" | Static, country-specific pick-list data. [VERIFIED] |
| `migrations/0002_property_geography.sql` | `ALTER TABLE properties ADD COLUMN country/wilaya/commune` | properties table | Lines 1–7; header "P4 — Algeria-shaped property address" | Schema shape is Algeria-specific. [VERIFIED] |
| `src/server/index.ts` | `DEFAULT_SETTINGS` → `currency: "DZD"`, `locale: "fr-DZ"` (lines 170–176); written into `settings` on first run (205–207); returned by GET/PUT `/api/settings` (1334, 1361) | settings table | Lines 170–176, 205–207, 1334, 1361 | Server embeds market defaults. [VERIFIED] |
| `src/server/index.ts` | `PropertyInput.country/wilaya/commune` (303–305); additive write loop (337–342); CSV property headers `commune/wilaya/country` (1624, 1630–1632) | properties table | Lines 303–305, 337–342, 1624–1632 | Validation/export shaped by Algeria geography. [VERIFIED] |
| `src/client/hooks/use-app-state.ts` | `DEFAULT_SETTINGS` → `currency: "DZD"`, `locale: "fr-DZ"` (30–36); `parseSettings` fallbacks (44, 47–48) | api.ts | Lines 30–36, 44–48 | Client embeds the same market defaults as the server. [VERIFIED] |
| `src/client/lib/utils.ts` | `formatMoney` fallback `|| "DZD"` (60); French `dd/MM/yyyy` date branch (`startsWith("fr")`, 47–50) | — | Lines 47–50, 58–60 | Formatting defaults hard-code the Algerian market. [VERIFIED] |
| `src/client/components/properties/property-dialog.tsx` | `country` default `"DZ"` (53, 69); wilaya `<Select>` fed by `WILAYAS` (163–168); commune input (172–174); import of `WILAYAS` (12); payload writes (88–90) | `@/lib/wilayas` | Lines 12, 53, 69, 88–90, 163–174 | UI imports market data directly and defaults the country to `DZ`. [VERIFIED] |
| `src/client/components/settings/settings-page.tsx` | Policy tab: locale `<Select>` hard-codes `en` / `fr-DZ` / `ar` (336–339); `currency: ... || "DZD"` clamp (296); placeholder `"DZD"` (327) | i18n | Lines 296, 327, 332–340 | Settings UI hard-wires the market's currency default and locale picklist. [VERIFIED] |
| `src/client/i18n/fr.json` | French catalog, includes `geo.wilaya/commune`, `units.sqft = "Surface (m²)"`, `option_fr_dz` | — | Lines 198–209, 393 | French (Algeria) catalog content — profile language. [VERIFIED] |
| `src/client/i18n/ar.json` | Arabic catalog, `geo`, metric sqft label | — | Lines 131–137, 198–209 | RTL profile language. [VERIFIED] |
| `src/client/i18n/en.json` | base catalog that also carries `geo.*`, metric/sqft-neutral, `option_fr_dz` (393) | — | Lines 198–209, 393 | English base is closest to "core" but currently co-owns profile keys — see §11. [VERIFIED] |
| `src/client/i18n/index.ts` | `Locale = "en" \| "ar" \| "fr-DZ"` (5); `CATALOGS` binds `"fr-DZ" → fr.json`, `"ar" → ar.json` (7); `SUPPORTED_LOCALES` (10) | catalogs | Lines 5–10 | The registry statically registers profile locales. [VERIFIED] |
| `src/client/hooks/use-app-state.ts` | `document.documentElement.dir = settings.locale === "ar" ? "rtl" : "ltr"` (100); `lang` set from locale (99) | — | Lines 99–101 | RTL activation is keyed to the `"ar"` profile locale. [VERIFIED] |
| `src/client/styles.css` | `--font-sans` includes `Cairo` (196); `[dir=rtl]`/`[lang=ar]` letter-spacing & stat-label rules (401, 434–448) | fonts | Lines 193–196, 401, 434–448 | Profile presentation layer (RTL + Arabic UI face). [VERIFIED] |
| `index.html` | `lang="fr"` (2); title `ORKESTRIX Property System` (6); meta "Système de gestion locative pour l'Algérie" (7); Cairo Google font (11) | fonts.googleapis.com | Lines 2, 6–7, 11 | Deployed shell baked with the Algerian product identity. [VERIFIED] |
| `src/client/types.ts` | `Property.country: string \| null`, `wilaya`, `commune` (13–15) | — | Lines 13–15 | Client entity exposes profile geography fields. [VERIFIED] |
| `src/server/index.ts` | DEMO seed: `DEMO_PROPERTIES` (Austin, TX, US), `DEMO_UNITS`, `DEMO_VENDORS` (178–197) | — | Lines 178–197 | **Conflict**: first-run demo data is US-shaped while defaults are DZD/fr-DZ. See §6.6, §11. [VERIFIED] |

---

## 4. Jurisdiction inventory

**Result: the jurisdiction layer is EMPTY today.** [VERIFIED — no markers found by grep over
`src/` for regulatory/market-legal concepts; see §8 for the method]

| Candidate | Verdict | Evidence | Note |
|---|---|---|---|
| `finance.ts.clampDueDay` (1..28) | CORE, **not** JURISDICTION | `finance.ts` lines 29–31; comment "SQLite-compatible" | Calendar/SQLite constraint on the month day, not an Algeria law. [VERIFIED] |
| `late_fee_amount`, `late_fee_grace_days`, `default_rent_due_day`, deposit | CORE (configurable) | settings table + `/api/settings` GET/PUT; `policy` tab | User policy, not jurisdiction rules. [VERIFIED] |
| Algerian law (e.g., deposit caps, notice periods, tenant protections, official identifiers) | **absent** | grep over `src/`, `migrations/` | Nothing implements jurisdiction-specific rules. [VERIFIED] |
| `AUTH_ENABLED` | DEPLOYMENT | `auth.ts` lines 172–181 | Ops flag exposed as a setting; deployment concern, not jurisdiction. [VERIFIED] |

---

## 5. Deployment inventory

| File | Symbol / section | Evidence | Classification reason |
|---|---|---|---|
| `wrangler.toml` | `name = "open-property"`, `main = src/server/index.ts`, D1 binding `DB`, `compatibility_flags = nodejs_compat`, `database_id = "local"` | Lines 1–9 | Runtime/deploy target (Cloudflare Workers + D1). [VERIFIED] |
| `package.json` | scripts `dev` (concurrently + wrangler port 8787), `db:migrate`, `build`, `typecheck`, `test`; deps incl. `wrangler ^4`, `hono`, `@clawnify/*` | Lines 1–56 | Build/run tooling. [VERIFIED] |
| `scripts/migrate.ts` | `DB_NAME = "open-property-db"`, `--local`, wrangler binding | Lines 27–30, 38–46 | Local D1 migration deployment. [VERIFIED] |
| `vite.config.ts` | `/api` proxy → `localhost:8787` | Lines 18–23 | Dev deployment assumption. [VERIFIED] |
| `vitest.config.ts` | node env, forks pool | Lines 4–8 | Test deployment. [VERIFIED] |
| `clawnify.json` | Clawnify deploy template; name "OpenProperty"; generic prompts (company_name, portfolio_size…) | Lines 1–57 | Upstream OSS deploy identity — generic, market-agnostic. [VERIFIED] |
| `.github/workflows/sync-branches.yml` | main ↔ master mirror | Lines 1–27 | Repository deployment. [VERIFIED] |
| `index.html` | brand title, meta description, language, font | Lines 2–11 | Deployed shell carries the product's market identity (see §3). [VERIFIED] |

---

## 6. Dependency map

### 6.1 Core imports/reads Profile data
| Edge | Where | Evidence |
|---|---|---|
| Property form (core-ish UI) imports `WILAYAS` (profile data) | `property-dialog.tsx:12` → `src/client/lib/wilayas.ts` | [VERIFIED] |
| i18n mechanism imports profile catalogs statically | `i18n/index.ts:1–3,7` → `en/ar/fr.json` | [VERIFIED] |

### 6.2 UI directly imports market data
| Edge | Where | Evidence |
|---|---|---|
| `PropertyDialog` renders the static 58-wilaya picker | `property-dialog.tsx:163–168` using `WILAYAS` | [VERIFIED] |
| Policy tab hard-codes `fr-DZ`/`ar` locale options | `settings-page.tsx:336–339` | [VERIFIED] |

### 6.3 Server embeds market defaults
| Edge | Where | Evidence |
|---|---|---|
| `DEFAULT_SETTINGS` (`DZD`, `fr-DZ`) seeded into `settings` on every cold first-run | `index.ts:170–176, 205–207` | [VERIFIED] |
| GET/PUT `/api/settings` merge over `DEFAULT_SETTINGS` | `index.ts:1334, 1361` | [VERIFIED] |

### 6.4 Business logic depends on market-specific values
| Edge | Where | Evidence |
|---|---|---|
| `formatMoney` falls back to `DZD` when no currency supplied | `utils.ts:60` | [VERIFIED] |
| `formatDate` branches to `dd/MM/yyyy` for `fr*` locales | `utils.ts:47–50` | [VERIFIED] |
| RTL `dir` derived from `settings.locale === "ar"` | `use-app-state.ts:100` | [VERIFIED] |
| Server validation/CSV shape includes `country/wilaya/commune` | `index.ts:303–305, 337–342, 1624–1632` | [VERIFIED] |
| `settings-page.tsx` clamps saved currency to `DZD` when blank | `settings-page.tsx:296` | [VERIFIED] |

### 6.5 Deployment assumptions leaking into product logic
| Edge | Where | Evidence |
|---|---|---|
| Product market defaults injected through the *deployment's* first-run seeding path (`ensureSeeded`) into user-writable settings rows | `index.ts:164–244` | [VERIFIED] |
| Demo/seed content (deployment first-run experience) is US-shaped inside a product whose defaults are Algerian | `index.ts:178–197` | [VERIFIED] |
| Deployed `index.html` shell carries market identity rather than neutral bootstrap | `index.html:2–11` | [VERIFIED] |

### 6.6 Notable inconsistency (profile conflict)
`DEFAULT_SETTINGS` say `DZD`/`fr-DZ`, but the demo portfolio is Austin, TX rows with
`2300`-level rents and `512-` US phone vendors. The demo data was never re-shaped to the
Algeria profile. [VERIFIED — index.ts:178–197 vs 170–176]

---

## 7. Leakage points (complete list)

1. `src/client/lib/wilayas.ts` — `WILAYAS` dataset (profile data file inside client core tree). [VERIFIED]
2. `src/client/components/properties/property-dialog.tsx` — `WILAYAS` import + `"DZ"` country default + wilaya/commune UI. [VERIFIED]
3. `src/server/index.ts` + `src/client/hooks/use-app-state.ts` — `DEFAULT_SETTINGS` `DZD` / `fr-DZ` (duplicated on both sides). [VERIFIED]
4. `src/client/lib/utils.ts` — `formatMoney` `|| "DZD"` fallback; `formatDate` French branch. [VERIFIED]
5. `src/client/components/settings/settings-page.tsx` — `|| "DZD"` clamp, `"DZD"` placeholder, hard-coded `fr-DZ`/`ar` locale select. [VERIFIED]
6. `src/client/i18n/index.ts` — locale union `"en" | "ar" | "fr-DZ"` and static `CATALOGS` binding. [VERIFIED]
7. `src/client/i18n/{ar,fr}.json` (+ market keys inside `en.json`) — profile catalogs. [VERIFIED]
8. `src/client/hooks/use-app-state.ts:99–100` — `dir="rtl"` keyed on `"ar"`; `lang` keyed on locale string. [VERIFIED]
9. `src/client/styles.css` — Cairo font stack + `[dir=rtl]`/`[lang=ar]` rule blocks. [VERIFIED]
10. `src/server/index.ts` schema/validation/CSV — `country/wilaya/commune` in `PropertyInput` and the properties CSV export. [VERIFIED]
11. `migrations/0002_property_geography.sql` — Algeria-shaped columns. [VERIFIED]
12. `index.html` — `lang="fr"`, "pour l'Algérie" meta, Cairo font, brand identity. [VERIFIED]
13. Demo seed (`DEMO_PROPERTIES/UNITS/VENDORS`) — US data in first-run path. [VERIFIED]
14. Tests pinning market behavior as product-wide invariants: `settings-i18n-errors.test.ts` (defaults fr-DZ/DZD), `localization-p4.test.ts` (fr-DZ/DZD/wilaya dataset), `export-csv.test.ts` ("renders DZD amounts as plain numbers"), `charges.test.ts` (DZD default). [VERIFIED]

---

## 8. Proposed boundary (smallest viable, based strictly on observed code)

**Not a framework. Not a plan to move files. The seam that already exists, made explicit.**

### Profile = a single, self-contained package of data + presentation + config
1. **Geo data**: `WILAYAS` + wilaya/commune/country model (the dataset and the schema
   extension `0002`).
2. **Market configuration**: default `currency`, `locale`, and policy defaults (due day 1,
   late fee 50, grace 5) — i.e., the *content* of `DEFAULT_SETTINGS`, not the settings
   mechanism.
3. **Locales**: the catalogs this market ships (`fr-DZ`, `ar`, and the base `en`) and their
   registration in the i18n registry.
4. **Presentation**: RTL/Cairo/`[dir=rtl]` styling and the French/Arabic sqft-as-m² labels.
5. **Market UI shapes**: wilaya/commune form fields, `DZ` country default, the locale picker
   options, the `DZD` currency placeholder/fallback.
6. **First-run content**: the market's demo/seed portfolio (today: US data — must be
   re-homed and, for the Algeria Profile, re-shaped; see §11).
7. **Product shell**: `index.html` market identity (brand, language, meta, fonts) — per
   `Docs/current/14-brand-architecture.md` the ORKESTRIX identity is a product decision,
   and it attaches to the layered product, not to Core. [INFERENCE from the brand doc]

### Core = everything else, with these exact abstraction points (already present)
- `finance.ts`, `leases.ts` — unchanged, pure, market-agnostic.
- `settings` table + `/api/settings` — the runtime knob; Core provides the mechanism,
  Profile provides defaults. This **is** the Profile's entry point.
- i18n `t/tf/resolveErrorMessage` — Core mechanism; catalogs injected by Profile.
- `formatDate/formatMoney/formatPeriod` — Core take explicit `locale`/`currency`
  parameters; the market fallback moves into Profile-supplied defaults.
- API routes, entities, audit, auth, CSV infra — generic; only the geo trio in
  `PropertyInput`/CSV and the geo columns need to be expressed as Profile-supplied
  extensions instead of hard-coded columns. [RECOMMENDATION]

### What the boundary does NOT require
- No new framework, no Profile Manager service, no DI container, no micro-frontends.
- No change to `finance.ts` / `leases.ts` business rules.
- The `settings` rows remain user-overridable after seeding (existing behavior).

---

## 9. What must NOT be changed

| # | Item | Why |
|---|---|---|
| 1 | `src/server/finance.ts`, `src/server/leases.ts` signatures & rules | Single source of business truth; tests prove they are market-agnostic already. [VERIFIED] |
| 2 | API contract (`/api/*` routes, payload shapes, error codes) | Client and tests depend on it; "Core + Profile = current product" is defined against this contract. [VERIFIED] |
| 3 | `settings` table semantics & `/api/settings` behavior (user overrides win over defaults) | Proof criterion 5. [VERIFIED] |
| 4 | `schema.sql` baseline + migration ledger order | Rows exist in prod/local D1; additive-only discipline. [VERIFIED] |
| 5 | DB entities & enums (`properties/units/tenants/leases/charges/payments/…` statuses) | Renaming breaks data + tests. [VERIFIED] |
| 6 | Deployment: `wrangler.toml`, D1 binding, scripts, ports, workflows, `clawnify.json` | Out of scope for this gate. [VERIFIED] |
| 7 | Upstream attribution / MIT license / README | Brand doc rule: never erase upstream attribution. [VERIFIED — 14-brand-architecture.md §Attribution] |
| 8 | UI visual behavior & RTL rendering of the current product | Any separation must reproduce identical UI (proof criterion 3). [INFERENCE] |
| 9 | Test suite expectations that pin the product contract | Existing tests are the proof oracle; changing them arbitrarily would invalidate criterion 3. [INFERENCE] |

---

## 10. Proof / acceptance criteria

Objective, runnable assertions a future implementation must satisfy.

**P1 — Core business logic has no Algeria dependency.**
- Grep over the Core set (`finance.ts`, `leases.ts`, generic routes, client shell minus
  Profile package) for `DZD|fr-DZ|wilaya|commune|WILAYAS|\bar\b|"DZ"|"ar"` → **0 hits**.
- `finance.test.ts`, `lease-occupancy.test.ts` run without any locale/currency seeding. [VERIFIED state today]

**P2 — Algeria-specific data/config is isolated in the Profile.**
- `WILAYAS`, `DZD`/`fr-DZ` defaults, `ar`/`fr` catalogs, migration 0002, RTL/Cairo CSS, and
  the geo trio exist **only** under the Profile package.
- A profile-less Core build compiles and typechecks with no reference to those symbols.

**P3 — Core + Algeria Profile reproduces current product behavior.**
- Full `pnpm test` passes against Core+Profile assembled exactly like today's tree.
- Subset assertions that must hold (already true at `aab9081`): cold-DB `/api/settings`
  returns `locale="fr-DZ"`, `currency="DZD"` (`settings-i18n-errors.test.ts:17–21`,
  `localization-p4.test.ts:214–217`); property CRUD persists `country/wilaya/commune`
  (`localization-p4.test.ts:160–194`); `formatMoney(1200,"DZD","fr-DZ")` contains
  `1 200 DA` (`localization-p4.test.ts:104`); `formatDate` → `dd/MM/yyyy`
  (`localization-p4.test.ts:110–117`); rent CSV renders whole numbers (`export-csv.test.ts:214`).

**P4 — Replacing the Profile requires no Core business-rule change.**
- Swap the Profile for a stub (e.g., `en` + `USD` + generic address, no wilayas) in a test
  assembly; `finance.ts`/`leases.ts` files are **identical** between the two assemblies.
- Only profile-scoped test expectations differ (locale/currency/geo); no core assertion
  changes.

**P5 — Settings remain user configuration, not a Profile replacement.**
- `PUT /api/settings` with `currency:"USD"` / `locale:"en"` persists and is returned
  (`audit.test.ts:182–198`, `settings-i18n-errors.test.ts:24–37`) — unchanged.
- Overriding currency/locale does not alter charge/occupancy computation (charges still
  generated from lease `monthly_rent` and `rent_due_day`) — already proven by the separation
  of formatting from rules. [INFERENCE — supported by `finance.ts` purity]

---

## 11. UNKNOWN items requiring verification (governance decisions or open questions)

1. **Ownership of `en.json`** — is the English catalog Core (base language for all markets)
   or Profile (one shipping language)? Today it also owns profile keys (`geo.*`,
   `option_fr_dz`, metric-neutral labels). Decision needed before the boundary is fixed.
   [UNKNOWN]
2. **Demo/seed data** — the first-run portfolio is US-shaped while defaults are Algerian.
   When a Profile owns first-run content: should the Algeria Profile get an Algeria-shaped
   demo (wilayas, DZD rents, +213 phones), or an empty portfolio? Current behavior is in
   conflict and must be decided, not inferred. [UNKNOWN]
3. **`index.html` shell ownership** — brand title/meta/language/font live in the deployed
   shell. Under `14-brand-architecture.md`, ORKESTRIX Property System is a product directive;
   whether the shell belongs to Profile (market identity) or DEPLOYMENT (per-product build)
   must be confirmed with the product owner. [UNKNOWN — brand doc is authoritative but
   silent on file placement]
4. **Future Jurisdiction scope** — is an Algeria jurisdiction content layer (legal rules)
   planned for later phases? Today the layer is empty; the gate only needs the layer to be
   *designated*, not populated. Confirm the V1 roadmap intent. [UNKNOWN]
5. **"fr" prefix formatting branch** — `formatDate` keys off `startsWith("fr")` rather than
   the registered locale. Is dd/MM/yyyy the Core behavior for all French locales or a
   Profile rule? [UNKNOWN — borderline, currently benign]
6. **`formatMoney` integer-only policy** — `maximumFractionDigits: 0` (whole dinars) is a
   deliberate style. Is that a Core rule or a market rule? [UNKNOWN — `formatMoney` doc
   comment suggests deliberate style choice]

---

## 12. Recommendation: **GO** (with preconditions)

**Architecture verdict: the separation is cleanly achievable. GO for implementation.**

Rationale:
- All business rules are already pure and market-agnostic (`finance.ts`, `leases.ts`). [VERIFIED]
- The complete set of profile leaks is enumerated (14 items, §7) and each is a *data or
  presentation* seam, not a *logic* seam. [VERIFIED]
- The settings table already provides the Profile's runtime entry point — the mechanism
  exists. [VERIFIED]
- No new framework or Profile Manager is needed to honor the boundary (§8). [RECOMMENDATION]

Preconditions before implementation starts (governance, not architecture):
1. Resolve UNKNOWN items §11.1–11.3 (en.json ownership, demo/seed re-homing, index.html
   shell ownership) — these are product decisions the auditor cannot make.
2. Confirm §11.4 (whether a Jurisdiction layer is in scope for V1). The gate passes either
   way; the layer is simply empty today.
3. Keep the "what must not change" list (§9) as the implementation's invariants.

If preconditions 1–2 cannot be decided, **HOLD** until they are — the architecture is ready,
but an implementation without those decisions would re-introduce leakage by default.

---

### Evidence-tag legend

- `[VERIFIED]` — directly observed in repository files at audit time (HEAD `aab9081` +
  inspected working tree).
- `[INFERENCE]` — reasoned from verified facts or authoritative docs
  (`Docs/current/14-brand-architecture.md`).
- `[RECOMMENDATION]` — auditor judgment within the gate's scope.
- `[UNKNOWN]` — requires a decision or verification outside the audit.

*Read-only gate. No application source, config, migration, test, or deployment artifact was
modified. No commit was created.*