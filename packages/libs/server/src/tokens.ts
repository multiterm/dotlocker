// #region -- Token store -----------------------------------

import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { DB } from "./db.js";
import { getUser } from "./users.js";
import { maybeGetService } from "./services.js";
import { validateScopes, type TokenScope } from "@dotlocker/shared";
import { isValidOrgName } from "@dotlocker/shared";
import {
  ConflictError,
  InvalidPathError,
  NotFoundError,
  UnauthorizedError,
} from "@dotlocker/shared";

const TOKEN_PREFIX = "plt_";
const ID_BYTES = 9; // 12 base64url chars
export const ID_LENGTH = 12; // base64url length of ID_BYTES bytes; pinned so verifyToken can slice by position rather than indexOf("_"), which is unsafe because the base64url alphabet contains "_".
const SECRET_BYTES = 24; // 32 base64url chars
const SECRET_LENGTH = 32; // base64url length of SECRET_BYTES bytes
const TOKEN_RE = new RegExp(
  `^${TOKEN_PREFIX}[A-Za-z0-9_-]{${ID_LENGTH}}_[A-Za-z0-9_-]{${SECRET_LENGTH}}$`,
);
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

export interface TokenRecord {
  readonly id: string;
  readonly org: string;
  readonly scopes: readonly TokenScope[];
  readonly label: string;
  readonly createdAt: number;
  readonly expiresAt: number | null;
  readonly revokedAt: number | null;
  readonly userEmail: string | null;
  readonly service: string | null;
}

export interface MintTokenInput {
  readonly org: string;
  readonly scopes: readonly TokenScope[];
  readonly label?: string;
  readonly expiresAt?: number | null;
  readonly userEmail?: string | null;
  readonly service?: string | null;
}

export interface MintTokenResult {
  readonly record: TokenRecord;
  readonly plaintext: string; // returned ONCE, never persisted
}

export function createOrg(db: DB, name: string): void {
  if (!isValidOrgName(name)) {
    throw new InvalidPathError("invalid org name", name);
  }
  const exists = db.prepare("SELECT name FROM orgs WHERE name = ?").get(name);
  if (exists) {
    throw new ConflictError(`org '${name}' already exists`);
  }
  db.prepare("INSERT INTO orgs (name, created_at) VALUES (?, ?)").run(name, Date.now());
}

export function listOrgs(db: DB): readonly string[] {
  const rows = db.prepare("SELECT name FROM orgs ORDER BY name").all() as readonly {
    name: string;
  }[];
  return rows.map((r) => r.name);
}

export function mintToken(db: DB, input: MintTokenInput): MintTokenResult {
  const { org, scopes, label = "", expiresAt = null, userEmail = null, service = null } = input;
  if (!isValidOrgName(org)) {
    throw new InvalidPathError("invalid org name", org);
  }
  const orgRow = db.prepare("SELECT name FROM orgs WHERE name = ?").get(org);
  if (!orgRow) {
    throw new NotFoundError(`org '${org}' not found`);
  }
  validateScopes(scopes, org);
  if (userEmail !== null) {
    const user = getUser(db, userEmail);
    if (user.verifiedAt === null) {
      throw new UnauthorizedError("PLUTO_EMAIL_UNVERIFIED", `user '${user.email}' is not verified`);
    }
  }
  if (service !== null && !maybeGetService(db, org, service)) {
    throw new NotFoundError(`service '${org}/${service}' not found`);
  }

  const id = randomBytes(ID_BYTES).toString("base64url");
  const secret = randomBytes(SECRET_BYTES).toString("base64url");
  const salt = randomBytes(SALT_BYTES).toString("base64url");
  const hash = scryptSync(secret, salt, SCRYPT_KEYLEN).toString("base64url");
  const createdAt = Date.now();

  db.prepare(
    `INSERT INTO tokens (id, org, hash, salt, scopes, label, user_email, service, created_at, expires_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
  ).run(
    id,
    org,
    hash,
    salt,
    JSON.stringify(scopes),
    label,
    userEmail,
    service,
    createdAt,
    expiresAt,
  );

  const plaintext = `${TOKEN_PREFIX}${id}_${secret}`;
  return {
    plaintext,
    record: {
      id,
      org,
      scopes,
      label,
      createdAt,
      expiresAt,
      revokedAt: null,
      userEmail,
      service,
    },
  };
}

interface TokenRow {
  readonly id: string;
  readonly org: string;
  readonly hash: string;
  readonly salt: string;
  readonly scopes: string;
  readonly label: string;
  readonly user_email?: string | null;
  readonly service?: string | null;
  readonly created_at: number;
  readonly expires_at: number | null;
  readonly revoked_at: number | null;
}

function rowToRecord(row: TokenRow): TokenRecord {
  return {
    id: row.id,
    org: row.org,
    scopes: JSON.parse(row.scopes) as readonly TokenScope[],
    label: row.label,
    createdAt: row.created_at,
    expiresAt: row.expires_at,
    revokedAt: row.revoked_at,
    userEmail: row.user_email ?? null,
    service: row.service ?? null,
  };
}

/**
 * Verify a plaintext bearer token. Returns the token record on success.
 * Throws UnauthorizedError on any failure (wrong format, unknown id, bad
 * secret, expired, revoked) — caller should NOT distinguish reasons in the
 * response, but the thrown ErrorCode is available for the audit log.
 */
export function verifyToken(db: DB, plaintext: string): TokenRecord {
  if (typeof plaintext !== "string" || !TOKEN_RE.test(plaintext)) {
    throw new UnauthorizedError();
  }
  const remainder = plaintext.slice(TOKEN_PREFIX.length);
  // Parse by fixed id length, not indexOf("_"): base64url ids contain "_" ~17%
  // of the time, which would otherwise mis-slice an id with an internal "_"
  // and silently fail an otherwise-valid token.
  if (remainder.length < ID_LENGTH + 2 || remainder[ID_LENGTH] !== "_") {
    throw new UnauthorizedError();
  }
  const id = remainder.slice(0, ID_LENGTH);
  const secret = remainder.slice(ID_LENGTH + 1);

  const row = db
    .prepare(
      `SELECT id, org, hash, salt, scopes, label, user_email, service, created_at, expires_at, revoked_at
     FROM tokens WHERE id = ?`,
    )
    .get(id) as TokenRow | undefined;
  if (!row) {
    throw new UnauthorizedError();
  }

  const computed = scryptSync(secret, row.salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(row.hash, "base64url");
  if (computed.length !== stored.length || !timingSafeEqual(computed, stored)) {
    throw new UnauthorizedError();
  }

  if (row.revoked_at !== null) {
    throw new UnauthorizedError("PLUTO_TOKEN_REVOKED", "token revoked");
  }
  if (row.expires_at !== null && row.expires_at <= Date.now()) {
    throw new UnauthorizedError("PLUTO_TOKEN_EXPIRED", "token expired");
  }

  return rowToRecord(row);
}

export function listTokens(db: DB, org: string): readonly TokenRecord[] {
  const rows = db
    .prepare(
      `SELECT id, org, hash, salt, scopes, label, user_email, service, created_at, expires_at, revoked_at
     FROM tokens WHERE org = ? ORDER BY created_at DESC`,
    )
    .all(org) as readonly TokenRow[];
  return rows.map(rowToRecord);
}

export function revokeToken(db: DB, id: string): void {
  const res = db
    .prepare("UPDATE tokens SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL")
    .run(Date.now(), id);
  if (res.changes === 0) {
    throw new NotFoundError(`token '${id}' not found or already revoked`);
  }
}

// #endregion ------------------------------------------------
