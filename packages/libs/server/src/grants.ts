// #region -- RBAC grants -----------------------------------

import type { DB } from "./db.js";
import {
  ConflictError,
  ForbiddenError,
  InvalidPathError,
  NotFoundError,
} from "@multiterm/pluto-shared";
import { isValidOrgName, isValidSegment, normalizePath } from "@multiterm/pluto-shared";
import type { Access } from "@multiterm/pluto-shared";
import { getUser } from "./users.js";

export type GrantAccess = "read" | "write" | "admin";

export interface GrantRecord {
  readonly kind: "org" | "repo" | "runtime";
  readonly email: string;
  readonly org: string;
  readonly repo: string | null;
  readonly runtime: string | null;
  readonly access: GrantAccess;
  readonly createdAt: number;
}

export function grantOrgAdmin(db: DB, emailInput: string, org: string): GrantRecord {
  const email = normalizeEmail(emailInput);
  assertUserAndOrg(db, email, org);
  const now = Date.now();
  db.prepare(
    `INSERT INTO org_memberships (email, org, role, created_at)
     VALUES (?, ?, 'org_admin', ?)
     ON CONFLICT(email, org) DO UPDATE SET role = 'org_admin'`,
  ).run(email, org, now);
  return { kind: "org", email, org, repo: null, runtime: null, access: "admin", createdAt: now };
}

export function grantRepo(
  db: DB,
  input: { email: string; org: string; repo: string; access: GrantAccess },
): GrantRecord {
  const email = normalizeEmail(input.email);
  assertUserAndOrg(db, email, input.org);
  assertName(input.repo, "repo");
  assertAccess(input.access);
  const now = Date.now();
  db.prepare(
    `INSERT INTO repo_grants (email, org, repo, access, created_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(email, org, repo) DO UPDATE SET access = excluded.access`,
  ).run(email, input.org, input.repo, input.access, now);
  return {
    kind: "repo",
    email,
    org: input.org,
    repo: input.repo,
    runtime: null,
    access: input.access,
    createdAt: now,
  };
}

export function grantRuntime(
  db: DB,
  input: { email: string; org: string; repo: string; runtime: string; access: GrantAccess },
): GrantRecord {
  const email = normalizeEmail(input.email);
  assertUserAndOrg(db, email, input.org);
  assertName(input.repo, "repo");
  assertName(input.runtime, "runtime");
  assertAccess(input.access);
  const now = Date.now();
  db.prepare(
    `INSERT INTO runtime_grants (email, org, repo, runtime, access, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(email, org, repo, runtime) DO UPDATE SET access = excluded.access`,
  ).run(email, input.org, input.repo, input.runtime, input.access, now);
  return {
    kind: "runtime",
    email,
    org: input.org,
    repo: input.repo,
    runtime: input.runtime,
    access: input.access,
    createdAt: now,
  };
}

export function revokeGrant(
  db: DB,
  input: { email: string; org: string; repo?: string | null; runtime?: string | null },
): void {
  const email = normalizeEmail(input.email);
  let changes = 0;
  if (input.repo && input.runtime) {
    changes = db
      .prepare(
        "DELETE FROM runtime_grants WHERE email = ? AND org = ? AND repo = ? AND runtime = ?",
      )
      .run(email, input.org, input.repo, input.runtime).changes;
  } else if (input.repo) {
    changes = db
      .prepare("DELETE FROM repo_grants WHERE email = ? AND org = ? AND repo = ?")
      .run(email, input.org, input.repo).changes;
  } else {
    changes = db
      .prepare("DELETE FROM org_memberships WHERE email = ? AND org = ?")
      .run(email, input.org).changes;
  }
  if (changes === 0) throw new NotFoundError("grant not found");
}

export function listOrgGrants(db: DB, org: string): readonly GrantRecord[] {
  const out: GrantRecord[] = [];
  const orgRows = db
    .prepare("SELECT email, org, role, created_at FROM org_memberships WHERE org = ?")
    .all(org) as Array<{ email: string; org: string; role: string; created_at: number }>;
  for (const r of orgRows)
    out.push({
      kind: "org",
      email: r.email,
      org: r.org,
      repo: null,
      runtime: null,
      access: "admin",
      createdAt: r.created_at,
    });
  const repoRows = db
    .prepare("SELECT email, org, repo, access, created_at FROM repo_grants WHERE org = ?")
    .all(org) as Array<{
    email: string;
    org: string;
    repo: string;
    access: GrantAccess;
    created_at: number;
  }>;
  for (const r of repoRows)
    out.push({
      kind: "repo",
      email: r.email,
      org: r.org,
      repo: r.repo,
      runtime: null,
      access: r.access,
      createdAt: r.created_at,
    });
  const runtimeRows = db
    .prepare(
      "SELECT email, org, repo, runtime, access, created_at FROM runtime_grants WHERE org = ?",
    )
    .all(org) as Array<{
    email: string;
    org: string;
    repo: string;
    runtime: string;
    access: GrantAccess;
    created_at: number;
  }>;
  for (const r of runtimeRows)
    out.push({
      kind: "runtime",
      email: r.email,
      org: r.org,
      repo: r.repo,
      runtime: r.runtime,
      access: r.access,
      createdAt: r.created_at,
    });
  return out.sort((a, b) =>
    `${a.email}:${a.kind}:${a.repo ?? ""}:${a.runtime ?? ""}`.localeCompare(
      `${b.email}:${b.kind}:${b.repo ?? ""}:${b.runtime ?? ""}`,
    ),
  );
}

export function listUserGrants(db: DB, emailInput: string, org?: string): readonly GrantRecord[] {
  const email = normalizeEmail(emailInput);
  const params = org ? [email, org] : [email];
  const orgWhere = org ? " AND org = ?" : "";
  const out: GrantRecord[] = [];
  const orgRows = db
    .prepare(`SELECT email, org, role, created_at FROM org_memberships WHERE email = ?${orgWhere}`)
    .all(...params) as Array<{ email: string; org: string; role: string; created_at: number }>;
  for (const r of orgRows)
    out.push({
      kind: "org",
      email: r.email,
      org: r.org,
      repo: null,
      runtime: null,
      access: "admin",
      createdAt: r.created_at,
    });
  const repoRows = db
    .prepare(
      `SELECT email, org, repo, access, created_at FROM repo_grants WHERE email = ?${orgWhere}`,
    )
    .all(...params) as Array<{
    email: string;
    org: string;
    repo: string;
    access: GrantAccess;
    created_at: number;
  }>;
  for (const r of repoRows)
    out.push({
      kind: "repo",
      email: r.email,
      org: r.org,
      repo: r.repo,
      runtime: null,
      access: r.access,
      createdAt: r.created_at,
    });
  const runtimeRows = db
    .prepare(
      `SELECT email, org, repo, runtime, access, created_at FROM runtime_grants WHERE email = ?${orgWhere}`,
    )
    .all(...params) as Array<{
    email: string;
    org: string;
    repo: string;
    runtime: string;
    access: GrantAccess;
    created_at: number;
  }>;
  for (const r of runtimeRows)
    out.push({
      kind: "runtime",
      email: r.email,
      org: r.org,
      repo: r.repo,
      runtime: r.runtime,
      access: r.access,
      createdAt: r.created_at,
    });
  return out.sort((a, b) =>
    `${a.kind}:${a.org}:${a.repo ?? ""}:${a.runtime ?? ""}`.localeCompare(
      `${b.kind}:${b.org}:${b.repo ?? ""}:${b.runtime ?? ""}`,
    ),
  );
}

export function hasAnyGrant(db: DB, email: string, org: string): boolean {
  const row = db
    .prepare(
      `SELECT 1 FROM org_memberships WHERE email = ? AND org = ?
     UNION SELECT 1 FROM repo_grants WHERE email = ? AND org = ?
     UNION SELECT 1 FROM runtime_grants WHERE email = ? AND org = ?
     LIMIT 1`,
    )
    .get(email, org, email, org, email, org);
  return Boolean(row);
}

export function authorizeGrant(
  db: DB,
  email: string | null | undefined,
  requestPath: string,
  access: Access,
): boolean {
  if (!email) return false;
  const n = normalizePath(requestPath);
  const [org, repo, runtime] = n.segments;
  if (!repo) return false;
  if (isOrgAdmin(db, email, org)) return true;
  const repoGrant = db
    .prepare("SELECT access FROM repo_grants WHERE email = ? AND org = ? AND repo = ?")
    .get(email, org, repo) as { access: GrantAccess } | undefined;
  if (repoGrant && accessAllows(repoGrant.access, access)) return true;
  if (!runtime) return false;
  const runtimeGrant = db
    .prepare(
      "SELECT access FROM runtime_grants WHERE email = ? AND org = ? AND repo = ? AND runtime = ?",
    )
    .get(email, org, repo, runtime) as { access: GrantAccess } | undefined;
  return Boolean(runtimeGrant && accessAllows(runtimeGrant.access, access));
}

export function isOrgAdmin(db: DB, email: string | null | undefined, org: string): boolean {
  if (!email) return false;
  const row = db
    .prepare("SELECT role FROM org_memberships WHERE email = ? AND org = ? AND role = 'org_admin'")
    .get(email, org);
  return Boolean(row);
}

export function requireOrgAdmin(db: DB, email: string | null | undefined, org: string): void {
  if (!isOrgAdmin(db, email, org)) throw new ForbiddenError("org admin required");
}

function accessAllows(grant: GrantAccess, request: Access): boolean {
  return grant === "admin" || grant === request || (grant === "write" && request === "read");
}

function normalizeEmail(email: string): string {
  return email.toLowerCase();
}

function assertUserAndOrg(db: DB, email: string, org: string): void {
  if (!isValidOrgName(org)) throw new InvalidPathError("invalid org", org);
  getUser(db, email);
  const row = db.prepare("SELECT name FROM orgs WHERE name = ?").get(org);
  if (!row) throw new NotFoundError(`org '${org}' not found`);
}

function assertName(name: string, label: string): void {
  if (!isValidSegment(name)) throw new InvalidPathError(`invalid ${label}`, name);
}

function assertAccess(access: GrantAccess): void {
  if (!["read", "write", "admin"].includes(access))
    throw new ConflictError(`invalid grant access '${access}'`);
}

// #endregion ------------------------------------------------
