// #region -- Users -----------------------------------------

import { createHmac, randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import type { DB } from "./db.js";
import {
  ConflictError,
  NotFoundError,
  UnauthorizedError,
  InvalidPathError,
} from "@multiterm/pluto-shared";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const SCRYPT_KEYLEN = 64;
const SALT_BYTES = 16;

export interface UserRecord {
  readonly email: string;
  readonly verifiedAt: number | null;
  readonly createdAt: number;
  readonly totpEnabledAt: number | null;
}

export interface CreateUserInput {
  readonly email: string;
  readonly password: string;
  readonly verified?: boolean;
}

export function isValidEmail(email: string): boolean {
  return EMAIL_RE.test(email) && email.length <= 320;
}

export function createUser(db: DB, input: CreateUserInput): UserRecord {
  const email = input.email.toLowerCase();
  if (!isValidEmail(email)) throw new InvalidPathError("invalid email", input.email);
  if (!input.password || input.password.length < 16)
    throw new InvalidPathError("password must be at least 16 characters", "password");
  const existing = db.prepare("SELECT email FROM users WHERE email = ?").get(email);
  if (existing) throw new ConflictError(`user '${email}' already exists`);
  const salt = randomBytes(SALT_BYTES).toString("base64url");
  const passwordHash = scryptSync(input.password, salt, SCRYPT_KEYLEN).toString("base64url");
  const now = Date.now();
  const verifiedAt = input.verified ? now : null;
  db.prepare(
    `INSERT INTO users (email, password_hash, password_salt, verified_at, created_at) VALUES (?, ?, ?, ?, ?)`,
  ).run(email, passwordHash, salt, verifiedAt, now);
  return { email, verifiedAt, createdAt: now, totpEnabledAt: null };
}

export function verifyUserEmail(db: DB, emailInput: string): UserRecord {
  const email = emailInput.toLowerCase();
  const now = Date.now();
  const res = db.prepare("UPDATE users SET verified_at = ? WHERE email = ?").run(now, email);
  if (res.changes === 0) throw new NotFoundError(`user '${email}' not found`);
  return getUser(db, email);
}

export function getUser(db: DB, emailInput: string): UserRecord {
  const email = emailInput.toLowerCase();
  const row = db
    .prepare("SELECT email, verified_at, created_at, totp_enabled_at FROM users WHERE email = ?")
    .get(email) as UserRow | undefined;
  if (!row) throw new NotFoundError(`user '${email}' not found`);
  return rowToUser(row);
}

export function listUsers(db: DB): readonly UserRecord[] {
  const rows = db
    .prepare("SELECT email, verified_at, created_at, totp_enabled_at FROM users ORDER BY email")
    .all() as readonly UserRow[];
  return rows.map(rowToUser);
}

export function assertUserPassword(db: DB, emailInput: string, password: string): UserRecord {
  const email = emailInput.toLowerCase();
  const row = db
    .prepare(
      "SELECT email, password_hash, password_salt, verified_at, created_at, totp_enabled_at FROM users WHERE email = ?",
    )
    .get(email) as (UserRow & { password_hash: string; password_salt: string }) | undefined;
  if (!row) throw new UnauthorizedError();
  const computed = scryptSync(password, row.password_salt, SCRYPT_KEYLEN);
  const stored = Buffer.from(row.password_hash, "base64url");
  if (computed.length !== stored.length || !timingSafeEqual(computed, stored))
    throw new UnauthorizedError();
  return rowToUser(row);
}

export function beginTotpSetup(db: DB, emailInput: string): { secret: string; otpauth: string } {
  const email = emailInput.toLowerCase();
  getUser(db, email);
  const secret = randomBytes(20).toString("base64url");
  db.prepare("UPDATE users SET totp_secret = ?, totp_enabled_at = NULL WHERE email = ?").run(
    secret,
    email,
  );
  return {
    secret,
    otpauth: `otpauth://totp/Pluto:${encodeURIComponent(email)}?secret=${encodeURIComponent(secret)}&issuer=Pluto`,
  };
}

export function enableTotp(db: DB, emailInput: string, code: string): UserRecord {
  const email = emailInput.toLowerCase();
  if (!verifyTotpForUser(db, email, code))
    throw new UnauthorizedError("PLUTO_INVALID_TOKEN", "invalid totp code");
  db.prepare("UPDATE users SET totp_enabled_at = ? WHERE email = ?").run(Date.now(), email);
  return getUser(db, email);
}

export function isTotpEnabled(db: DB, emailInput: string): boolean {
  const row = db
    .prepare("SELECT totp_enabled_at FROM users WHERE email = ?")
    .get(emailInput.toLowerCase()) as { totp_enabled_at: number | null } | undefined;
  return Boolean(row?.totp_enabled_at);
}

export function verifyTotpForUser(db: DB, emailInput: string, code: string): boolean {
  const row = db
    .prepare("SELECT totp_secret FROM users WHERE email = ?")
    .get(emailInput.toLowerCase()) as { totp_secret: string | null } | undefined;
  if (!row?.totp_secret || !/^\d{6}$/.test(code)) return false;
  return verifyTotp(row.totp_secret, code);
}

interface UserRow {
  readonly email: string;
  readonly verified_at: number | null;
  readonly created_at: number;
  readonly totp_enabled_at?: number | null;
}
function rowToUser(row: UserRow): UserRecord {
  return {
    email: row.email,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    totpEnabledAt: row.totp_enabled_at ?? null,
  };
}

function verifyTotp(secret: string, code: string, now = Date.now()): boolean {
  const step = Math.floor(now / 30_000);
  for (const offset of [-1, 0, 1]) if (totp(secret, step + offset) === code) return true;
  return false;
}

function totp(secret: string, counter: number): string {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64BE(BigInt(counter));
  const h = createHmac("sha1", Buffer.from(secret, "base64url")).update(buf).digest();
  const o = h[h.length - 1] & 0x0f;
  const n =
    ((h[o] & 0x7f) << 24) |
    ((h[o + 1] & 0xff) << 16) |
    ((h[o + 2] & 0xff) << 8) |
    (h[o + 3] & 0xff);
  return String(n % 1_000_000).padStart(6, "0");
}

// #endregion ------------------------------------------------
