// #region -- Auth store abstraction ------------------------

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import postgres from "postgres";
import type { Access, TokenScope } from "@dotlocker/shared";
import { validateScopes } from "@dotlocker/shared";
import {
  ConflictError,
  InvalidPathError,
  NotFoundError,
  UnauthorizedError,
} from "@dotlocker/shared";
import { isValidOrgName, isValidSegment, normalizePath } from "@dotlocker/shared";
import type { DB } from "./db.js";
import type { UserRecord } from "./users.js";
import {
  assertUserPassword,
  createUser,
  getUser,
  isTotpEnabled,
  verifyTotpForUser,
} from "./users.js";
import type { GrantAccess, GrantRecord } from "./grants.js";
import {
  authorizeGrant,
  grantOrgAdmin,
  grantRepo,
  grantRuntime,
  hasAnyGrant,
  isOrgAdmin,
  listOrgGrants,
  listUserGrants,
  requireOrgAdmin,
  revokeGrant,
} from "./grants.js";
import {
  createOrg,
  listTokens,
  mintToken,
  revokeToken,
  verifyToken,
  type MintTokenInput,
  type MintTokenResult,
  type TokenRecord,
} from "./tokens.js";

const TOKEN_PREFIX = "plt_";
const ID_BYTES = 9;
const ID_LENGTH = 12;
const SECRET_BYTES = 24;
const SECRET_LENGTH = 32;
const TOKEN_RE = new RegExp(
  `^${TOKEN_PREFIX}[A-Za-z0-9_-]{${ID_LENGTH}}_[A-Za-z0-9_-]{${SECRET_LENGTH}}$`,
);
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

export interface AuthStore {
  readonly kind: "sqlite" | "postgres";
  assertPassword(email: string, password: string): Promise<UserRecord>;
  isTotpEnabled(email: string): Promise<boolean>;
  verifyTotp(email: string, code: string): Promise<boolean>;
  createUser(input: { email: string; password: string; verified?: boolean }): Promise<UserRecord>;
  isEmpty(): Promise<boolean>;
  resolveKeynameIdentity(input: {
    subject: string;
    email: string;
    emailVerified: boolean;
  }): Promise<UserRecord>;
  keynameIdentity(email: string): Promise<string | null>;
  createOrganization(name: string, ownerEmail: string): Promise<void>;
  hasAnyGrant(email: string, org: string): Promise<boolean>;
  accessibleOrgs(email: string): Promise<string[]>;
  listUserGrants(email: string, org?: string): Promise<readonly GrantRecord[]>;
  listOrgGrants(org: string): Promise<readonly GrantRecord[]>;
  requireOrgAdmin(email: string | null | undefined, org: string): Promise<void>;
  isOrgAdmin(email: string | null | undefined, org: string): Promise<boolean>;
  authorizeGrant(email: string | null | undefined, path: string, access: Access): Promise<boolean>;
  grantOrgAdmin(email: string, org: string): Promise<GrantRecord>;
  grantRepo(input: {
    email: string;
    org: string;
    repo: string;
    access: GrantAccess;
  }): Promise<GrantRecord>;
  grantRuntime(input: {
    email: string;
    org: string;
    repo: string;
    runtime: string;
    access: GrantAccess;
  }): Promise<GrantRecord>;
  revokeGrant(input: {
    email: string;
    org: string;
    repo?: string | null;
    runtime?: string | null;
  }): Promise<void>;
  mintToken(input: MintTokenInput): Promise<MintTokenResult>;
  verifyToken(plaintext: string): Promise<TokenRecord>;
  listTokens(org: string): Promise<readonly TokenRecord[]>;
  switchTokenOrg(id: string, org: string): Promise<void>;
  revokeToken(id: string): Promise<void>;
}

export function sqliteAuthStore(db: DB): AuthStore {
  return {
    kind: "sqlite",
    assertPassword: async (e, p) => assertUserPassword(db, e, p),
    isTotpEnabled: async (e) => isTotpEnabled(db, e),
    verifyTotp: async (e, c) => verifyTotpForUser(db, e, c),
    createUser: async (input) => createUser(db, input),
    isEmpty: async () => {
      const users = db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
      const orgs = db.prepare("SELECT COUNT(*) AS count FROM orgs").get() as { count: number };
      return users.count === 0 && orgs.count === 0;
    },
    resolveKeynameIdentity: async (input) => resolveSqliteKeynameIdentity(db, input),
    keynameIdentity: async (email) => {
      const row = db.prepare("SELECT keyname_subject FROM users WHERE email = ?").get(email) as
        | { keyname_subject: string | null }
        | undefined;
      return row?.keyname_subject ?? null;
    },
    createOrganization: async (name, ownerEmail) => {
      db.transaction(() => {
        createOrg(db, name);
        grantOrgAdmin(db, ownerEmail, name);
      })();
    },
    hasAnyGrant: async (e, o) => hasAnyGrant(db, e, o),
    accessibleOrgs: async (e) => accessibleOrgsSqlite(db, e),
    listUserGrants: async (e, o) => listUserGrants(db, e, o),
    listOrgGrants: async (o) => listOrgGrants(db, o),
    requireOrgAdmin: async (e, o) => requireOrgAdmin(db, e, o),
    isOrgAdmin: async (e, o) => isOrgAdmin(db, e, o),
    authorizeGrant: async (e, p, a) => authorizeGrant(db, e, p, a),
    grantOrgAdmin: async (e, o) => grantOrgAdmin(db, e, o),
    grantRepo: async (input) => grantRepo(db, input),
    grantRuntime: async (input) => grantRuntime(db, input),
    revokeGrant: async (input) => revokeGrant(db, input),
    mintToken: async (input) => mintToken(db, input),
    verifyToken: async (plaintext) => verifyToken(db, plaintext),
    listTokens: async (org) => listTokens(db, org),
    switchTokenOrg: async (id, org) => {
      const result = db
        .prepare("UPDATE tokens SET org = ?, scopes = ? WHERE id = ? AND revoked_at IS NULL")
        .run(org, JSON.stringify([{ path: `${org}/_session`, access: "read" }]), id);
      if (result.changes !== 1) throw new NotFoundError(`token '${id}' not found or already revoked`);
    },
    revokeToken: async (id) => revokeToken(db, id),
  };
}

export function postgresAuthStore(sql: postgres.Sql): AuthStore {
  return new PgAuthStore(sql);
}

class PgAuthStore implements AuthStore {
  readonly kind = "postgres" as const;
  constructor(private readonly sql: postgres.Sql) {}

  async assertPassword(emailInput: string, password: string): Promise<UserRecord> {
    const email = emailInput.toLowerCase();
    const [row] = await this
      .sql`SELECT email,password_hash,password_salt,verified_at,created_at,totp_enabled_at FROM users WHERE email=${email}`;
    if (!row) throw new UnauthorizedError();
    const computed = scryptSync(password, row.password_salt, SCRYPT_KEYLEN);
    const stored = Buffer.from(row.password_hash, "base64url");
    if (computed.length !== stored.length || !timingSafeEqual(computed, stored))
      throw new UnauthorizedError();
    return userRow(row);
  }
  async isTotpEnabled(email: string): Promise<boolean> {
    const [r] = await this
      .sql`SELECT totp_enabled_at FROM users WHERE email=${email.toLowerCase()}`;
    return Boolean(r?.totp_enabled_at);
  }
  async verifyTotp(): Promise<boolean> {
    return false; /* TODO: share TOTP verifier with users.ts for Postgres */
  }
  async createUser(input: {
    email: string;
    password: string;
    verified?: boolean;
  }): Promise<UserRecord> {
    const email = input.email.toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      throw new InvalidPathError("invalid email", email);
    if (!input.password || input.password.length < 16)
      throw new InvalidPathError("password must be at least 16 characters", "password");
    const salt = randomBytes(SALT_BYTES).toString("base64url");
    const passwordHash = scryptSync(input.password, salt, SCRYPT_KEYLEN).toString("base64url");
    const now = Date.now();
    const verifiedAt = input.verified ? now : null;
    try {
      await this
        .sql`INSERT INTO users (email,password_hash,password_salt,verified_at,created_at) VALUES (${email},${passwordHash},${salt},${verifiedAt},${now})`;
    } catch {
      throw new ConflictError(`user '${email}' already exists`);
    }
    return { email, verifiedAt, createdAt: now, totpEnabledAt: null };
  }
  async isEmpty(): Promise<boolean> {
    const [row] = await this.sql`SELECT
      (SELECT COUNT(*)::int FROM users) AS users,
      (SELECT COUNT(*)::int FROM orgs) AS orgs`;
    return Number(row?.users ?? 0) === 0 && Number(row?.orgs ?? 0) === 0;
  }
  async resolveKeynameIdentity(input: {
    subject: string;
    email: string;
    emailVerified: boolean;
  }): Promise<UserRecord> {
    if (!input.emailVerified) throw new UnauthorizedError("PLUTO_EMAIL_UNVERIFIED", "Keyname email is not verified");
    const email = input.email.trim().toLowerCase();
    const [bySubject] = await this.sql`SELECT email,verified_at,created_at,totp_enabled_at FROM users WHERE keyname_subject=${input.subject}`;
    if (bySubject) return userRow(bySubject);
    // Early Pluto versions stored the verified Keyname email in this column
    // instead of the immutable subject. Upgrade that unambiguous legacy link.
    const [byLegacyEmail] = await this.sql`SELECT email,verified_at,created_at,totp_enabled_at FROM users WHERE LOWER(keyname_subject)=${email} AND keyname_subject LIKE '%@%'`;
    if (byLegacyEmail) {
      const verifiedAt = byLegacyEmail.verified_at ?? Date.now();
      const [claimed] = await this.sql`UPDATE users SET keyname_subject=${input.subject}, verified_at=${verifiedAt} WHERE email=${byLegacyEmail.email} AND LOWER(keyname_subject)=${email} RETURNING email,verified_at,created_at,totp_enabled_at`;
      if (claimed) return userRow(claimed);
    }
    const [byEmail] = await this.sql`SELECT email,verified_at,created_at,totp_enabled_at,keyname_subject FROM users WHERE email=${email}`;
    if (!byEmail) {
      if ((process.env.DOTLOCKER_KEYNAME_CLAIM_SINGLE_LEGACY_USER ?? process.env.PLUTO_KEYNAME_CLAIM_SINGLE_LEGACY_USER) === "true") {
        const candidates = await this.sql`SELECT email,verified_at,created_at,totp_enabled_at FROM users WHERE keyname_subject IS NULL ORDER BY created_at LIMIT 2`;
        if (candidates.length === 1) {
          const [claimed] = await this.sql`UPDATE users SET keyname_subject=${input.subject}, verified_at=COALESCE(verified_at,${Date.now()}) WHERE email=${candidates[0].email} AND keyname_subject IS NULL RETURNING email,verified_at,created_at,totp_enabled_at`;
          if (claimed) return userRow(claimed);
        }
      }
      throw new NotFoundError(`No Pluto account is provisioned for '${email}'`);
    }
    if (byEmail.keyname_subject && byEmail.keyname_subject !== input.subject)
      throw new ConflictError("Pluto account is already linked to another Keyname identity");
    const verifiedAt = byEmail.verified_at ?? Date.now();
    await this.sql`UPDATE users SET keyname_subject=${input.subject}, verified_at=${verifiedAt} WHERE email=${email}`;
    return userRow({ ...byEmail, verified_at: verifiedAt });
  }
  async keynameIdentity(email: string): Promise<string | null> {
    const [row] = await this.sql`SELECT keyname_subject FROM users WHERE email=${email}`;
    return (row?.keyname_subject as string | null | undefined) ?? null;
  }
  async createOrganization(name: string, ownerEmail: string): Promise<void> {
    if (!isValidOrgName(name)) throw new InvalidPathError("invalid org name", name);
    try {
      await this.sql.begin(async (tx) => {
        await tx`INSERT INTO orgs (name,created_at) VALUES (${name},${Date.now()})`;
        await tx`INSERT INTO org_memberships (email,org,role,created_at) VALUES (${ownerEmail},${name},'org_admin',${Date.now()})`;
      });
    } catch {
      throw new ConflictError(`org '${name}' already exists`);
    }
  }
  async hasAnyGrant(email: string, org: string): Promise<boolean> {
    const [r] = await this
      .sql`SELECT 1 FROM org_memberships WHERE email=${email} AND org=${org} UNION SELECT 1 FROM repo_grants WHERE email=${email} AND org=${org} UNION SELECT 1 FROM runtime_grants WHERE email=${email} AND org=${org} LIMIT 1`;
    return Boolean(r);
  }
  async accessibleOrgs(email: string): Promise<string[]> {
    const rows = await this
      .sql`SELECT org FROM org_memberships WHERE email=${email} UNION SELECT org FROM repo_grants WHERE email=${email} UNION SELECT org FROM runtime_grants WHERE email=${email} ORDER BY org`;
    return rows.map((r) => r.org as string);
  }
  async listUserGrants(email: string, org?: string): Promise<readonly GrantRecord[]> {
    return grantRows(
      await this.sql.unsafe(
        userGrantSql(Boolean(org)),
        org ? [email, org, email, org, email, org] : [email, email, email],
      ),
    );
  }
  async listOrgGrants(org: string): Promise<readonly GrantRecord[]> {
    return grantRows(await this.sql.unsafe(orgGrantSql(), [org, org, org]));
  }
  async isOrgAdmin(email: string | null | undefined, org: string): Promise<boolean> {
    if (!email) return false;
    const [r] = await this
      .sql`SELECT role FROM org_memberships WHERE email=${email} AND org=${org} AND role='org_admin'`;
    return Boolean(r);
  }
  async requireOrgAdmin(email: string | null | undefined, org: string): Promise<void> {
    if (!(await this.isOrgAdmin(email, org)))
      throw new UnauthorizedError("PLUTO_FORBIDDEN", "org admin required");
  }
  async authorizeGrant(
    email: string | null | undefined,
    requestPath: string,
    access: Access,
  ): Promise<boolean> {
    if (!email) return false;
    const [org, repo, runtime] = normalizePath(requestPath).segments;
    if (!repo) return false;
    if (await this.isOrgAdmin(email, org)) return true;
    const [rg] = await this
      .sql`SELECT access FROM repo_grants WHERE email=${email} AND org=${org} AND repo=${repo}`;
    if (rg && accessAllows(rg.access, access)) return true;
    if (!runtime) return false;
    const [rt] = await this
      .sql`SELECT access FROM runtime_grants WHERE email=${email} AND org=${org} AND repo=${repo} AND runtime=${runtime}`;
    return Boolean(rt && accessAllows(rt.access, access));
  }
  async grantOrgAdmin(emailInput: string, org: string): Promise<GrantRecord> {
    const email = emailInput.toLowerCase();
    await this.assertUserOrg(email, org);
    const now = Date.now();
    await this
      .sql`INSERT INTO org_memberships (email,org,role,created_at) VALUES (${email},${org},'org_admin',${now}) ON CONFLICT (email,org) DO UPDATE SET role='org_admin'`;
    return { kind: "org", email, org, repo: null, runtime: null, access: "admin", createdAt: now };
  }
  async grantRepo(input: {
    email: string;
    org: string;
    repo: string;
    access: GrantAccess;
  }): Promise<GrantRecord> {
    const email = input.email.toLowerCase();
    await this.assertUserOrg(email, input.org);
    assertName(input.repo);
    const now = Date.now();
    await this
      .sql`INSERT INTO repo_grants (email,org,repo,access,created_at) VALUES (${email},${input.org},${input.repo},${input.access},${now}) ON CONFLICT (email,org,repo) DO UPDATE SET access=${input.access}`;
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
  async grantRuntime(input: {
    email: string;
    org: string;
    repo: string;
    runtime: string;
    access: GrantAccess;
  }): Promise<GrantRecord> {
    const email = input.email.toLowerCase();
    await this.assertUserOrg(email, input.org);
    assertName(input.repo);
    assertName(input.runtime);
    const now = Date.now();
    await this
      .sql`INSERT INTO runtime_grants (email,org,repo,runtime,access,created_at) VALUES (${email},${input.org},${input.repo},${input.runtime},${input.access},${now}) ON CONFLICT (email,org,repo,runtime) DO UPDATE SET access=${input.access}`;
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
  async revokeGrant(input: {
    email: string;
    org: string;
    repo?: string | null;
    runtime?: string | null;
  }): Promise<void> {
    const email = input.email.toLowerCase();
    let res;
    if (input.repo && input.runtime)
      res = await this
        .sql`DELETE FROM runtime_grants WHERE email=${email} AND org=${input.org} AND repo=${input.repo} AND runtime=${input.runtime}`;
    else if (input.repo)
      res = await this
        .sql`DELETE FROM repo_grants WHERE email=${email} AND org=${input.org} AND repo=${input.repo}`;
    else
      res = await this.sql`DELETE FROM org_memberships WHERE email=${email} AND org=${input.org}`;
    if (res.count === 0) throw new NotFoundError("grant not found");
  }
  async mintToken(input: MintTokenInput): Promise<MintTokenResult> {
    const { org, scopes, label = "", expiresAt = null, userEmail = null, service = null } = input;
    if (!isValidOrgName(org)) throw new InvalidPathError("invalid org name", org);
    const [o] = await this.sql`SELECT name FROM orgs WHERE name=${org}`;
    if (!o) throw new NotFoundError(`org '${org}' not found`);
    validateScopes(scopes, org);
    const id = randomBytes(ID_BYTES).toString("base64url"),
      secret = randomBytes(SECRET_BYTES).toString("base64url"),
      salt = randomBytes(SALT_BYTES).toString("base64url"),
      hash = scryptSync(secret, salt, SCRYPT_KEYLEN).toString("base64url"),
      createdAt = Date.now();
    await this
      .sql`INSERT INTO auth_tokens (id,org,hash,salt,scopes,label,user_email,created_at,expires_at,revoked_at) VALUES (${id},${org},${hash},${salt},${JSON.stringify(scopes)},${label},${userEmail},${createdAt},${expiresAt},NULL)`;
    return {
      plaintext: `${TOKEN_PREFIX}${id}_${secret}`,
      record: { id, org, scopes, label, createdAt, expiresAt, revokedAt: null, userEmail, service },
    };
  }
  async verifyToken(plaintext: string): Promise<TokenRecord> {
    if (!TOKEN_RE.test(plaintext)) throw new UnauthorizedError();
    const rem = plaintext.slice(TOKEN_PREFIX.length);
    const id = rem.slice(0, ID_LENGTH),
      secret = rem.slice(ID_LENGTH + 1);
    const [row] = await this
      .sql`SELECT id,org,hash,salt,scopes,label,user_email,created_at,expires_at,revoked_at FROM auth_tokens WHERE id=${id}`;
    if (!row) throw new UnauthorizedError();
    const computed = scryptSync(secret, row.salt, SCRYPT_KEYLEN),
      stored = Buffer.from(row.hash, "base64url");
    if (computed.length !== stored.length || !timingSafeEqual(computed, stored))
      throw new UnauthorizedError();
    if (row.revoked_at !== null)
      throw new UnauthorizedError("PLUTO_TOKEN_REVOKED", "token revoked");
    if (row.expires_at !== null && Number(row.expires_at) <= Date.now())
      throw new UnauthorizedError("PLUTO_TOKEN_EXPIRED", "token expired");
    return tokenRow(row);
  }
  async listTokens(org: string): Promise<readonly TokenRecord[]> {
    const rows = await this
      .sql`SELECT id,org,hash,salt,scopes,label,user_email,created_at,expires_at,revoked_at FROM auth_tokens WHERE org=${org} ORDER BY created_at DESC`;
    return rows.map(tokenRow);
  }
  async switchTokenOrg(id: string, org: string): Promise<void> {
    const scopes = JSON.stringify([{ path: `${org}/_session`, access: "read" }]);
    const result = await this
      .sql`UPDATE auth_tokens SET org=${org}, scopes=${scopes} WHERE id=${id} AND revoked_at IS NULL`;
    if (result.count !== 1) throw new NotFoundError(`token '${id}' not found or already revoked`);
  }
  async revokeToken(id: string): Promise<void> {
    const res = await this
      .sql`UPDATE auth_tokens SET revoked_at=${Date.now()} WHERE id=${id} AND revoked_at IS NULL`;
    if (res.count === 0) throw new NotFoundError(`token '${id}' not found or already revoked`);
  }
  private async assertUserOrg(email: string, org: string): Promise<void> {
    if (!isValidOrgName(org)) throw new InvalidPathError("invalid org", org);
    const [u] = await this.sql`SELECT email FROM users WHERE email=${email}`;
    if (!u) throw new NotFoundError(`user '${email}' not found`);
    const [o] = await this.sql`SELECT name FROM orgs WHERE name=${org}`;
    if (!o) throw new NotFoundError(`org '${org}' not found`);
  }
}

function resolveSqliteKeynameIdentity(
  db: DB,
  input: { subject: string; email: string; emailVerified: boolean },
): UserRecord {
  if (!input.emailVerified)
    throw new UnauthorizedError("PLUTO_EMAIL_UNVERIFIED", "Keyname email is not verified");
  const email = input.email.trim().toLowerCase();
  const bySubject = db
    .prepare("SELECT email,verified_at,created_at,totp_enabled_at FROM users WHERE keyname_subject = ?")
    .get(input.subject) as any;
  if (bySubject) return userRow(bySubject);
  const byLegacyEmail = db
    .prepare(
      "SELECT email,verified_at,created_at,totp_enabled_at FROM users WHERE LOWER(keyname_subject) = ? AND keyname_subject LIKE '%@%'",
    )
    .get(email) as any;
  if (byLegacyEmail) {
    const verifiedAt = byLegacyEmail.verified_at ?? Date.now();
    const claimed = db
      .prepare(
        "UPDATE users SET keyname_subject = ?, verified_at = ? WHERE email = ? AND LOWER(keyname_subject) = ?",
      )
      .run(input.subject, verifiedAt, byLegacyEmail.email, email);
    if (claimed.changes === 1) return userRow({ ...byLegacyEmail, verified_at: verifiedAt });
  }
  const byEmail = db
    .prepare("SELECT email,verified_at,created_at,totp_enabled_at,keyname_subject FROM users WHERE email = ?")
    .get(email) as any;
  if (!byEmail) {
    if ((process.env.DOTLOCKER_KEYNAME_CLAIM_SINGLE_LEGACY_USER ?? process.env.PLUTO_KEYNAME_CLAIM_SINGLE_LEGACY_USER) === "true") {
      const candidates = db
        .prepare("SELECT email,verified_at,created_at,totp_enabled_at FROM users WHERE keyname_subject IS NULL ORDER BY created_at LIMIT 2")
        .all() as any[];
      if (candidates.length === 1) {
        const candidate = candidates[0];
        const verifiedAt = candidate.verified_at ?? Date.now();
        const claimed = db
          .prepare("UPDATE users SET keyname_subject = ?, verified_at = ? WHERE email = ? AND keyname_subject IS NULL")
          .run(input.subject, verifiedAt, candidate.email);
        if (claimed.changes === 1) return userRow({ ...candidate, verified_at: verifiedAt });
      }
    }
    throw new NotFoundError(`No Pluto account is provisioned for '${email}'`);
  }
  if (byEmail.keyname_subject && byEmail.keyname_subject !== input.subject)
    throw new ConflictError("Pluto account is already linked to another Keyname identity");
  const verifiedAt = byEmail.verified_at ?? Date.now();
  db.prepare("UPDATE users SET keyname_subject = ?, verified_at = ? WHERE email = ?").run(
    input.subject,
    verifiedAt,
    email,
  );
  return userRow({ ...byEmail, verified_at: verifiedAt });
}

function accessibleOrgsSqlite(db: DB, email: string): string[] {
  return (
    db
      .prepare(
        `SELECT org FROM org_memberships WHERE email = ? UNION SELECT org FROM repo_grants WHERE email = ? UNION SELECT org FROM runtime_grants WHERE email = ? ORDER BY org`,
      )
      .all(email, email, email) as Array<{ org: string }>
  ).map((r) => r.org);
}
function userRow(r: any): UserRecord {
  return {
    email: r.email,
    verifiedAt: r.verified_at,
    createdAt: Number(r.created_at),
    totpEnabledAt: r.totp_enabled_at ?? null,
  };
}
function tokenRow(r: any): TokenRecord {
  return {
    id: r.id,
    org: r.org,
    scopes: JSON.parse(r.scopes),
    label: r.label,
    createdAt: Number(r.created_at),
    expiresAt: r.expires_at === null ? null : Number(r.expires_at),
    revokedAt: r.revoked_at === null ? null : Number(r.revoked_at),
    userEmail: r.user_email ?? null,
    service: null,
  };
}
function grantRows(rows: any[]): GrantRecord[] {
  return rows.map((r) => ({
    kind: r.kind,
    email: r.email,
    org: r.org,
    repo: r.repo,
    runtime: r.runtime,
    access: r.access,
    createdAt: Number(r.created_at),
  }));
}
function userGrantSql(hasOrg: boolean): string {
  const w = hasOrg ? " AND org=$2" : "";
  return `SELECT 'org' kind,email,org,NULL repo,NULL runtime,'admin' access,created_at FROM org_memberships WHERE email=$1${w} UNION ALL SELECT 'repo',email,org,repo,NULL,access,created_at FROM repo_grants WHERE email=$${hasOrg ? 3 : 2}${hasOrg ? " AND org=$4" : ""} UNION ALL SELECT 'runtime',email,org,repo,runtime,access,created_at FROM runtime_grants WHERE email=$${hasOrg ? 5 : 3}${hasOrg ? " AND org=$6" : ""}`;
}
function orgGrantSql(): string {
  return `SELECT 'org' kind,email,org,NULL repo,NULL runtime,'admin' access,created_at FROM org_memberships WHERE org=$1 UNION ALL SELECT 'repo',email,org,repo,NULL,access,created_at FROM repo_grants WHERE org=$2 UNION ALL SELECT 'runtime',email,org,repo,runtime,access,created_at FROM runtime_grants WHERE org=$3`;
}
function accessAllows(grant: string, request: Access): boolean {
  return grant === "admin" || grant === request || (grant === "write" && request === "read");
}
function assertName(name: string): void {
  if (!isValidSegment(name)) throw new InvalidPathError("invalid segment", name);
}

// #endregion ------------------------------------------------
