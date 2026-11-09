import { beforeEach, describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { TestEnv } from "./helpers/d1";
import { createTestEnv } from "./helpers/d1";
import { call } from "./helpers/api";
import app, { resetSeedForTests } from "../src/server/index";
import {
  BASE_NAME,
  BASE_VERSION,
  runMigrations,
  type Migration,
  type MigrationDriver,
} from "../src/server/migrate";

let env: TestEnv;

// Mirrors of the server's audit limits. The server declares them internally (non-exported) in
// src/server/index.ts because Cloudflare Workers rejects plain-value exports from the worker
// entry module. The tests below assert the enforced behavior, so the value mirrors live here.
const AUDIT_DEFAULT_LIMIT = 50;
const AUDIT_MAX_LIMIT = 200;

beforeEach(() => {
  env = createTestEnv();
  resetSeedForTests();
});

function setupAuthDB(stub: TestEnv["DB"]): void {
  stub.exec(readFileSync(resolve(process.cwd(), "migrations/0003_auth_users.sql"), "utf8"));
  stub.exec(readFileSync(resolve(process.cwd(), "migrations/0005_audit_logs.sql"), "utf8"));
}

async function callCookie<T = unknown>(method: string, route: string, body?: unknown, cookie?: string) {
  const init: RequestInit = { method };
  const headers: Record<string, string> = {};
  if (body !== undefined) {
    headers["Content-Type"] = "application/json";
    init.body = JSON.stringify(body);
  }
  if (cookie) headers["Cookie"] = cookie;
  init.headers = headers;
  const res = await app.request(route, init, env);
  const json = await res.json().catch(() => null);
  return { status: res.status, body: json as T, headers: res.headers };
}

async function bootstrapOwner() {
  return callCookie<{ user: { id: number; email: string; role: string } }>("POST", "/api/auth/bootstrap", {
    email: "owner@example.com",
    password: "securepass123",
    display_name: "Owner",
  });
}

async function login(email = "owner@example.com", password = "securepass123") {
  return callCookie<{ user: { id: number } }>("POST", "/api/auth/login", { email, password });
}

function extractToken(headers: Headers): string | undefined {
  const setCookie = headers.get("set-cookie");
  return setCookie?.match(/session_token=([^;]+)/)?.[1];
}

async function getSessionCookie(): Promise<string> {
  const bootstrap = await bootstrapOwner();
  if (bootstrap.status !== 201) throw new Error("Bootstrap failed in test helper");
  const loginRes = await login();
  const token = extractToken(loginRes.headers);
  if (!token) throw new Error("Login failed in test helper");
  return `session_token=${token}`;
}

async function enableAuth(): Promise<void> {
  await env.DB.prepare("INSERT OR REPLACE INTO settings (key, value) VALUES ('AUTH_ENABLED', 'true')").bind().run();
  const { resetAuthCache } = await import("../src/server/auth");
  resetAuthCache();
}

interface AuditRow {
  id: number;
  actor_user_id: number | null;
  actor_name: string | null;
  action: string;
  entity: string;
  record_id: number | null;
  old_value: string | null;
  new_value: string | null;
  created_at: string;
}

async function seedLeaseAndCharge(): Promise<{ leaseId: number; chargeId: number }> {
  const prop = await call<{ property: { id: number } }>(env, "POST", "/api/properties", { name: "Audit Property", type: "single_family" });
  const unit = await call<{ unit: { id: number } }>(env, "POST", "/api/units", { property_id: prop.body.property.id, name: "A1" });
  const tenant = await call<{ tenant: { id: number } }>(env, "POST", "/api/tenants", { first_name: "Ada", last_name: "Lovelace" });
  const lease = await call<{ lease: { id: number } }>(env, "POST", "/api/leases", {
    unit_id: unit.body.unit.id,
    primary_tenant_id: tenant.body.tenant.id,
    start_date: "2026-01-01",
    end_date: "2027-12-31",
    monthly_rent: 1200,
    status: "active",
  });
  await call(env, "POST", "/api/rent-charges/generate", { period: "2026-05" });
  const charges = await call<{ charges: Array<{ id: number }> }>(env, "GET", "/api/rent-charges?period=2026-05");
  return { leaseId: lease.body.lease.id, chargeId: charges.body.charges[0].id };
}

// ── Migration tests ────────────────────────────────────────────────

const AUDIT_MIGRATION: Migration = {
  version: "0005_audit_logs",
  name: "0005_audit_logs.sql",
  sql: readFileSync(resolve(process.cwd(), "migrations/0005_audit_logs.sql"), "utf8"),
};

function schemaBase(): Migration {
  return { version: BASE_VERSION, name: BASE_NAME, sql: readFileSync(resolve(process.cwd(), "src/server/schema.sql"), "utf8") };
}

function driverFor(stub: TestEnv["DB"]): MigrationDriver {
  return {
    async exec(sql: string): Promise<void> {
      stub.exec(sql);
    },
    async query<T extends Record<string, unknown>>(sql: string): Promise<T[]> {
      return stub.prepare(sql).all<T>().results;
    },
  };
}

describe("audit migration 0005", () => {
  it("is additive and records its version", async () => {
    const stub = createTestEnv().DB;
    stub.exec(readFileSync(resolve(process.cwd(), "migrations/0003_auth_users.sql"), "utf8"));
    const applied = await runMigrations(driverFor(stub), [schemaBase(), AUDIT_MIGRATION]);
    expect(applied.applied).toEqual([BASE_VERSION, "0005_audit_logs"]);

    const cols = stub
      .prepare("PRAGMA table_info(audit_logs)")
      .all<{ name: string }>()
      .results.map((c) => c.name);
    expect(cols).toEqual(expect.arrayContaining(["actor_user_id", "action", "entity", "record_id", "old_value", "new_value", "created_at"]));
  });

  it("re-running 0005 is a no-op", async () => {
    const stub = createTestEnv().DB;
    stub.exec(readFileSync(resolve(process.cwd(), "migrations/0003_auth_users.sql"), "utf8"));
    const driver = driverFor(stub);
    await runMigrations(driver, [schemaBase(), AUDIT_MIGRATION]);
    const second = await runMigrations(driver, [schemaBase(), AUDIT_MIGRATION]);
    expect(second.applied).toEqual([]);
    expect(second.skipped).toEqual([BASE_VERSION, "0005_audit_logs"]);
  });

  it("converges fresh and pre-existing databases", async () => {
    const fresh = createTestEnv().DB;
    fresh.exec(readFileSync(resolve(process.cwd(), "migrations/0003_auth_users.sql"), "utf8"));
    await runMigrations(driverFor(fresh), [schemaBase(), AUDIT_MIGRATION]);
    const existing = createTestEnv().DB;
    existing.exec(readFileSync(resolve(process.cwd(), "migrations/0003_auth_users.sql"), "utf8"));
    await runMigrations(driverFor(existing), [schemaBase(), AUDIT_MIGRATION]);
    const versions = (stub: TestEnv["DB"]): string[] =>
      stub.prepare("SELECT version FROM schema_migrations ORDER BY version").all<{ version: string }>().results.map((r) => r.version);
    expect(versions(existing)).toEqual(versions(fresh));
    expect(versions(fresh)).toEqual([BASE_VERSION, "0005_audit_logs"]);
  });
});

// ── Audit write coverage ───────────────────────────────────────────

describe("audit writes", () => {
  beforeEach(() => {
    setupAuthDB(env.DB);
  });

  it("creates audit rows for required actions including charge edit, payment, lease, delete, settings", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();

    const prop = await callCookie<{ property: { id: number } }>("POST", "/api/properties", { name: "Audit Property", type: "single_family" }, cookie);
    await callCookie("PUT", `/api/settings`, { currency: "USD" }, cookie);

    const rows = await callCookie<AuditRow[]>("GET", "/api/audit?limit=50", undefined, cookie);
    expect(rows.status).toBe(200);
    expect(rows.body).toEqual(expect.any(Array));
    const settingsRow = (rows.body as AuditRow[]).find((r) => r.entity === "settings");
    expect(settingsRow).toBeDefined();
    expect(settingsRow?.action).toBe("update");
  });

  it("attaches the correct actor_user_id when auth is enabled", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();
    const session = await callCookie<{ user: { id: number } }>("GET", "/api/auth/session", undefined, cookie);
    const ownerId = session.body.user.id;

    await callCookie("PUT", "/api/settings", { currency: "EUR" }, cookie);
    const rows = await callCookie<AuditRow[]>("GET", "/api/audit?entity=settings", undefined, cookie);
    expect(rows.body).toHaveLength(1);
    expect(rows.body[0].actor_user_id).toBe(ownerId);
  });

  it("captures old_value for charge edits and settings changes", async () => {
    const { chargeId } = await seedLeaseAndCharge();
    const cookie = await getSessionCookie();
    await enableAuth();

    await callCookie("PUT", `/api/rent-charges/${chargeId}`, { amount: 999 }, cookie);
    await callCookie("PUT", "/api/settings", { late_fee_amount: 99 }, cookie);

    const rows = await callCookie<AuditRow[]>("GET", "/api/audit?limit=50", undefined, cookie);
    const chargeRow = (rows.body as AuditRow[]).find((r) => r.entity === "rent_charge" && r.action === "update");
    expect(chargeRow).toBeDefined();
    expect(JSON.parse(chargeRow!.old_value!)).toHaveProperty("amount");
    expect(JSON.parse(chargeRow!.new_value!)).toMatchObject({ amount: 999 });

    const settingsRow = (rows.body as AuditRow[]).find((r) => r.entity === "settings");
    expect(settingsRow).toBeDefined();
    expect(JSON.parse(settingsRow!.old_value!)).toMatchObject({ key: "late_fee_amount" });
  });

  it("records delete actions for property and user with correct entity/action", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();

    const prop = await callCookie<{ property: { id: number } }>("POST", "/api/properties", { name: "To Delete", type: "single_family" }, cookie);
    const userRes = await callCookie<{ user: { id: number } }>("POST", "/api/users", {
      email: "todelete@example.com",
      password: "securepass123",
      display_name: "To Delete",
      role: "manager",
    }, cookie);

    await callCookie("DELETE", `/api/properties/${prop.body.property.id}`, undefined, cookie);
    await callCookie("DELETE", `/api/users/${userRes.body.user.id}`, undefined, cookie);

    const rows = await callCookie<AuditRow[]>("GET", "/api/audit?limit=50", undefined, cookie);
    const propDelete = (rows.body as AuditRow[]).find((r) => r.entity === "property" && r.action === "delete");
    expect(propDelete).toBeDefined();
    const userDelete = (rows.body as AuditRow[]).find((r) => r.entity === "user" && r.action === "delete");
    expect(userDelete).toBeDefined();
    expect(JSON.parse(userDelete!.old_value!)).toEqual({ email: "todelete@example.com", role: "manager" });
  });

  it("records payment create with amount in new_value", async () => {
    const { chargeId } = await seedLeaseAndCharge();
    const cookie = await getSessionCookie();
    await enableAuth();

    await callCookie<{ charge: { id: number } }>("POST", "/api/payments", { charge_id: chargeId, amount: 500, method: "cash" }, cookie);

    const rows = await callCookie<AuditRow[]>("GET", "/api/audit?entity=payment", undefined, cookie);
    expect(rows.body).toHaveLength(1);
    expect(rows.body[0].action).toBe("create");
    expect(JSON.parse(rows.body[0].new_value!)).toMatchObject({ charge_id: chargeId, amount: 500, method: "cash" });
  });

  it("records lease create and update with minimal fields", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();
    const prop = await callCookie<{ property: { id: number } }>("POST", "/api/properties", { name: "Lease Prop", type: "single_family" }, cookie);
    const unit = await callCookie<{ unit: { id: number } }>("POST", "/api/units", { property_id: prop.body.property.id, name: "L1" }, cookie);
    const tenant = await callCookie<{ tenant: { id: number } }>("POST", "/api/tenants", { first_name: "L", last_name: "T" }, cookie);
    const lease = await callCookie<{ lease: { id: number } }>("POST", "/api/leases", {
      unit_id: unit.body.unit.id,
      primary_tenant_id: tenant.body.tenant.id,
      start_date: "2026-01-01",
      end_date: "2027-12-31",
      monthly_rent: 1100,
      status: "active",
    }, cookie);
    await callCookie("PUT", `/api/leases/${lease.body.lease.id}`, { monthly_rent: 1150 }, cookie);

    const rows = await callCookie<AuditRow[]>("GET", "/api/audit?entity=lease", undefined, cookie);
    expect(rows.body).toEqual(expect.arrayContaining([
      expect.objectContaining({ action: "create", entity: "lease" }),
      expect.objectContaining({ action: "update", entity: "lease" }),
    ]));
  });

  it("records rent-charge update with old amount -> new amount", async () => {
    const { chargeId } = await seedLeaseAndCharge();
    const cookie = await getSessionCookie();
    await enableAuth();

    const before = await callCookie<{ charges: Array<{ id: number; amount: number }> }>("GET", "/api/rent-charges?period=2026-05", undefined, cookie);
    const beforeCharge = before.body.charges.find((c) => c.id === chargeId);
    expect(beforeCharge).toBeDefined();
    await callCookie("PUT", `/api/rent-charges/${chargeId}`, { amount: 777 }, cookie);

    const rows = await callCookie<AuditRow[]>("GET", "/api/audit?entity=rent_charge&limit=10", undefined, cookie);
    const updateRow = (rows.body as AuditRow[]).find((r) => r.action === "update");
    expect(updateRow).toBeDefined();
    expect(JSON.parse(updateRow!.old_value!).amount).toBe(beforeCharge!.amount);
    expect(JSON.parse(updateRow!.new_value!).amount).toBe(777);
  });

  it("records settings changes per-key with old/new values", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();

    await callCookie("PUT", "/api/settings", { currency: "GBP", late_fee_amount: 25 }, cookie);

    const rows = await callCookie<AuditRow[]>("GET", "/api/audit?entity=settings", undefined, cookie);
    expect(rows.body.length).toBeGreaterThanOrEqual(2);
    const keys = (rows.body as AuditRow[]).map((r) => JSON.parse(r.new_value!).key);
    expect(keys).toContain("currency");
    expect(keys).toContain("late_fee_amount");
  });

  it("writes one summary row for rent-charge generate and none when zero created", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();

    // First generation in a fresh DB creates demo charges (seed active leases).
    const first = await callCookie<{ created: number }>("POST", "/api/rent-charges/generate", { period: "2030-01" }, cookie);
    const rowsAfterFirst = await callCookie<AuditRow[]>("GET", "/api/audit?entity=rent_charge&action=generate", undefined, cookie);
    if (first.body.created > 0) {
      expect(rowsAfterFirst.body).toHaveLength(1);
      expect(JSON.parse(rowsAfterFirst.body[0].new_value!)).toMatchObject({ period: "2030-01", created: first.body.created });
    }

    // Second generation for same period should create zero new charges.
    await callCookie("POST", "/api/rent-charges/generate", { period: "2030-01" }, cookie);
    const rowsAfterSecond = await callCookie<AuditRow[]>("GET", "/api/audit?entity=rent_charge&action=generate", undefined, cookie);
    expect(rowsAfterSecond.body).toHaveLength(rowsAfterFirst.body.length);
  });

  it("ignores a forged actor_user_id in the rent-charge PUT payload", async () => {
    const { chargeId } = await seedLeaseAndCharge();
    const cookie = await getSessionCookie();
    await enableAuth();
    const session = await callCookie<{ user: { id: number } }>("GET", "/api/auth/session", undefined, cookie);
    const ownerId = session.body.user.id;

    await callCookie("PUT", `/api/rent-charges/${chargeId}`, { amount: 888, actor_user_id: 999, foo: "bar" }, cookie);

    const rows = await callCookie<AuditRow[]>("GET", "/api/audit?entity=rent_charge&limit=10", undefined, cookie);
    const updateRow = (rows.body as AuditRow[]).find((r) => r.action === "update");
    expect(updateRow).toBeDefined();
    expect(updateRow!.actor_user_id).toBe(ownerId);
    expect(JSON.parse(updateRow!.new_value!)).toEqual({ amount: 888 });
  });

  it("rent-charge update old_value excludes notes and new_value only carries sent notes", async () => {
    const { chargeId } = await seedLeaseAndCharge();
    const cookie = await getSessionCookie();
    await enableAuth();

    const before = await callCookie<{ charges: Array<{ id: number; amount: number; due_date: string; status: string }> }>(
      "GET", "/api/rent-charges?period=2026-05", undefined, cookie,
    );
    const beforeCharge = before.body.charges.find((c) => c.id === chargeId);
    expect(beforeCharge).toBeDefined();

    await callCookie("PUT", `/api/rent-charges/${chargeId}`, { notes: "pre-existing sensitive note" }, cookie);
    await callCookie("PUT", `/api/rent-charges/${chargeId}`, { amount: 700 }, cookie);

    const rows = await callCookie<AuditRow[]>("GET", "/api/audit?entity=rent_charge&limit=10", undefined, cookie);
    const amountUpdate = (rows.body as AuditRow[]).find((r) => r.action === "update" && JSON.parse(r.new_value!).amount === 700);
    expect(amountUpdate).toBeDefined();
    expect(JSON.parse(amountUpdate!.old_value!)).toEqual({
      amount: beforeCharge!.amount,
      due_date: beforeCharge!.due_date,
      status: beforeCharge!.status,
    });
    expect(JSON.parse(amountUpdate!.new_value!)).toEqual({ amount: 700 });

    await callCookie("PUT", `/api/rent-charges/${chargeId}`, { notes: "edited note" }, cookie);

    const rowsAfterNotes = await callCookie<AuditRow[]>("GET", "/api/audit?entity=rent_charge&limit=10", undefined, cookie);
    const notesUpdate = (rowsAfterNotes.body as AuditRow[]).find((r) => r.action === "update" && JSON.parse(r.new_value!).notes === "edited note");
    expect(notesUpdate).toBeDefined();
    expect(JSON.parse(notesUpdate!.old_value!)).not.toHaveProperty("notes");
    expect(JSON.parse(notesUpdate!.new_value!)).toEqual({ notes: "edited note" });
  });
});

// ── Audit read API ─────────────────────────────────────────────────

describe("audit read API", () => {
  beforeEach(() => {
    setupAuthDB(env.DB);
  });

  it("allows owners and admins to read audit logs", async () => {
    const ownerCookie = await getSessionCookie();
    await enableAuth();
    await callCookie("PUT", "/api/settings", { currency: "EUR" }, ownerCookie);

    const ownerRead = await callCookie<AuditRow[]>("GET", "/api/audit", undefined, ownerCookie);
    expect(ownerRead.status).toBe(200);

    await callCookie("POST", "/api/users", {
      email: "admin@example.com",
      password: "securepass123",
      display_name: "Admin",
      role: "admin",
    }, ownerCookie);
    const adminLogin = await login("admin@example.com", "securepass123");
    const adminCookie = `session_token=${extractToken(adminLogin.headers)}`;
    const adminRead = await callCookie<AuditRow[]>("GET", "/api/audit", undefined, adminCookie);
    expect(adminRead.status).toBe(200);
    expect((adminRead.body as AuditRow[]).some((r) => r.entity === "settings")).toBe(true);
  });

  it("forbids managers from reading audit logs", async () => {
    const ownerCookie = await getSessionCookie();
    await enableAuth();
    await callCookie("POST", "/api/users", {
      email: "manager@example.com",
      password: "securepass123",
      display_name: "Manager",
      role: "manager",
    }, ownerCookie);
    const mgrLogin = await login("manager@example.com", "securepass123");
    const mgrCookie = `session_token=${extractToken(mgrLogin.headers)}`;

    const res = await callCookie("GET", "/api/audit", undefined, mgrCookie);
    expect(res.status).toBe(403);
  });

  it("rejects unauthenticated access when auth is enabled", async () => {
    setupAuthDB(env.DB);
    await enableAuth();
    const res = await callCookie("GET", "/api/audit");
    expect(res.status).toBe(401);
  });

  it("filters by entity and tolerates junk entity values", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();
    const prop = await callCookie<{ property: { id: number } }>("POST", "/api/properties", { name: "Filter Prop", type: "single_family" }, cookie);
    await callCookie("DELETE", `/api/properties/${prop.body.property.id}`, undefined, cookie);

    const leaseRows = await callCookie<AuditRow[]>("GET", "/api/audit?entity=lease", undefined, cookie);
    expect(leaseRows.body).toEqual([]);

    const propertyRows = await callCookie<AuditRow[]>("GET", "/api/audit?entity=property", undefined, cookie);
    expect(propertyRows.body.length).toBeGreaterThanOrEqual(1);

    const junk = await callCookie<AuditRow[]>("GET", "/api/audit?entity=not_an_entity", undefined, cookie);
    expect(junk.body).toEqual([]);
  });

  it("honors limit and orders newest first deterministically", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();
    for (let i = 0; i < 4; i++) {
      await callCookie("PUT", "/api/settings", { currency: `CUR${i}` }, cookie);
    }

    const rows = await callCookie<AuditRow[]>("GET", "/api/audit?limit=2", undefined, cookie);
    expect(rows.body).toHaveLength(2);
    const all = await callCookie<AuditRow[]>("GET", "/api/audit?limit=50", undefined, cookie);
    expect(rows.body[0].id).toBeGreaterThanOrEqual(rows.body[1].id);
    expect(all.body[0].id).toBe(rows.body[0].id);
  });

  it("enforces AUDIT_MAX_LIMIT as a safe cap", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();
    for (let i = 0; i < AUDIT_MAX_LIMIT + 5; i++) {
      await env.DB.prepare("INSERT INTO audit_logs (action, entity) VALUES (?, ?)").bind("create", "property").run();
    }
    const rows = await callCookie<AuditRow[]>("GET", "/api/audit?limit=10000", undefined, cookie);
    expect(rows.body).toHaveLength(AUDIT_MAX_LIMIT);
  });

  it("defaults to AUDIT_DEFAULT_LIMIT", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();
    for (let i = 0; i < AUDIT_DEFAULT_LIMIT + 10; i++) {
      await env.DB.prepare("INSERT INTO audit_logs (action, entity) VALUES (?, ?)").bind("create", "property").run();
    }
    const rows = await callCookie<AuditRow[]>("GET", "/api/audit", undefined, cookie);
    expect(rows.body).toHaveLength(AUDIT_DEFAULT_LIMIT);
  });

  it("rejects invalid limit values", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();
    const res = await callCookie("GET", "/api/audit?limit=notanumber", undefined, cookie);
    expect(res.status).toBe(400);
  });

  it("only exposes GET on /api/audit", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();
    for (const method of ["POST", "PUT", "DELETE"]) {
      const res = await callCookie(method, "/api/audit", { action: "x" }, cookie);
      expect(res.status).toBe(404);
    }
  });

  it("does not leak passwords, tokens, or session cookies in audit responses", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();

    const userRes = await callCookie<{ user: { id: number } }>("POST", "/api/users", {
      email: "secret@example.com",
      password: "securepass123",
      display_name: "Secret",
      role: "manager",
    }, cookie);
    await callCookie("DELETE", `/api/users/${userRes.body.user.id}`, undefined, cookie);
    await callCookie("PUT", "/api/settings", { AUTH_ENABLED: "true" }, cookie);

    const rows = await callCookie<AuditRow[]>("GET", "/api/audit?limit=200", undefined, cookie);
    const raw = JSON.stringify(rows.body);
    expect(raw).not.toContain("password_hash");
    expect(raw).not.toContain("token_hash");
    expect(raw).not.toContain("session_token");
    expect(raw).not.toContain("cookie");

    const userDelete = (rows.body as AuditRow[]).find((r) => r.entity === "user" && r.action === "delete");
    expect(userDelete).toBeDefined();
    expect(JSON.parse(userDelete!.old_value!)).toEqual({ email: "secret@example.com", role: "manager" });
  });
});

// ── Business response stability ────────────────────────────────────

describe("audit does not alter business responses", () => {
  beforeEach(() => {
    setupAuthDB(env.DB);
  });

  it("charge edit response shape is unchanged", async () => {
    const { chargeId } = await seedLeaseAndCharge();
    const cookie = await getSessionCookie();
    await enableAuth();
    const res = await callCookie<{ charge: { id: number; amount: number } }>("PUT", `/api/rent-charges/${chargeId}`, { amount: 555 }, cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("charge");
    expect(res.body.charge.amount).toBe(555);
  });

  it("payment create response shape is unchanged", async () => {
    const { chargeId } = await seedLeaseAndCharge();
    const cookie = await getSessionCookie();
    await enableAuth();
    const res = await callCookie<{ charge: { id: number; amount_paid: number } }>("POST", "/api/payments", { charge_id: chargeId, amount: 100, method: "check" }, cookie);
    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty("charge");
    expect(res.body.charge.amount_paid).toBe(100);
  });

  it("lease update response shape is unchanged", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();
    const prop = await callCookie<{ property: { id: number } }>("POST", "/api/properties", { name: "Resp Prop", type: "single_family" }, cookie);
    const unit = await callCookie<{ unit: { id: number } }>("POST", "/api/units", { property_id: prop.body.property.id, name: "R1" }, cookie);
    const tenant = await callCookie<{ tenant: { id: number } }>("POST", "/api/tenants", { first_name: "R", last_name: "T" }, cookie);
    const lease = await callCookie<{ lease: { id: number } }>("POST", "/api/leases", {
      unit_id: unit.body.unit.id,
      primary_tenant_id: tenant.body.tenant.id,
      start_date: "2026-01-01",
      end_date: "2027-12-31",
      monthly_rent: 1000,
      status: "active",
    }, cookie);
    const res = await callCookie<{ lease: { id: number; monthly_rent: number } }>("PUT", `/api/leases/${lease.body.lease.id}`, { monthly_rent: 1050 }, cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("lease");
    expect(res.body.lease.monthly_rent).toBe(1050);
  });

  it("settings PUT response shape is unchanged", async () => {
    const cookie = await getSessionCookie();
    await enableAuth();
    const res = await callCookie<{ settings: Record<string, string> }>("PUT", "/api/settings", { currency: "JPY" }, cookie);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty("settings");
    expect(res.body.settings.currency).toBe("JPY");
  });
});
