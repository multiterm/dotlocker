#!/usr/bin/env tsx
import { createRequire } from "node:module";
import { migratePostgres } from "../../packages/libs/server/src/db/postgres-migrate.js";

const require = createRequire(new URL("../../packages/libs/server/package.json", import.meta.url));
const Database = require("better-sqlite3") as typeof import("better-sqlite3").default;
const postgres = require("postgres") as typeof import("postgres").default;

const sqlitePath = process.argv[2];
const databaseUrl = process.env.PLUTO_DATABASE_URL ?? process.env.DATABASE_URL;
if (!sqlitePath || !databaseUrl) {
  throw new Error("usage: PLUTO_DATABASE_URL=postgres://... tsx migrate-sqlite-to-postgres.ts <pluto.db>");
}

const source = new Database(sqlitePath, { readonly: true, fileMustExist: true });
const sql = postgres(databaseUrl, { max: 1 });

const tableMap = [
  ["orgs", "orgs"],
  ["users", "users"],
  ["services", "services"],
  ["tokens", "auth_tokens"],
  ["org_memberships", "org_memberships"],
  ["repo_grants", "repo_grants"],
  ["runtime_grants", "runtime_grants"],
  ["file_records", "file_records"],
  ["audit", "audit"],
] as const;

const columns: Record<(typeof tableMap)[number][0], readonly string[]> = {
  orgs: ["name", "created_at"],
  users: [
    "email",
    "password_hash",
    "password_salt",
    "verified_at",
    "created_at",
    "totp_secret",
    "totp_enabled_at",
    "keyname_subject",
  ],
  services: ["org", "name", "owner_email", "allowed_sources", "created_at", "updated_at"],
  tokens: [
    "id",
    "org",
    "hash",
    "salt",
    "scopes",
    "label",
    "user_email",
    "service",
    "created_at",
    "expires_at",
    "revoked_at",
  ],
  org_memberships: ["email", "org", "role", "created_at"],
  repo_grants: ["email", "org", "repo", "access", "created_at"],
  runtime_grants: ["email", "org", "repo", "runtime", "access", "created_at"],
  file_records: [
    "path",
    "org",
    "repo",
    "runtime",
    "rel_path",
    "size",
    "sha256",
    "uploaded_by",
    "created_at",
    "updated_at",
    "deleted_at",
  ],
  audit: ["id", "ts", "org", "token_id", "action", "path", "status", "ip", "warning"],
};

try {
  await migratePostgres(sql);
  const [{ count }] = await sql`SELECT
    (SELECT COUNT(*) FROM users) +
    (SELECT COUNT(*) FROM orgs) +
    (SELECT COUNT(*) FROM auth_tokens) AS count`;
  if (Number(count) !== 0) {
    throw new Error(`refusing to backfill non-empty PostgreSQL target (${count} identity rows)`);
  }

  await sql.begin(async (tx) => {
    for (const [sourceTable, targetTable] of tableMap) {
      const selectedColumns = columns[sourceTable];
      const rows = source
        .prepare(`SELECT ${selectedColumns.map(quoteIdentifier).join(", ")} FROM ${quoteIdentifier(sourceTable)}`)
        .all() as Array<Record<string, unknown>>;
      for (const row of rows) {
        const values = selectedColumns.map((column) => row[column]);
        const placeholders = selectedColumns.map((_, index) => `$${index + 1}`).join(", ");
        await tx.unsafe(
          `INSERT INTO ${quoteIdentifier(targetTable)} (${selectedColumns.map(quoteIdentifier).join(", ")}) VALUES (${placeholders})`,
          values,
        );
      }
      process.stdout.write(`${sourceTable} -> ${targetTable}: ${rows.length}\n`);
    }
    await tx`SELECT setval(pg_get_serial_sequence('audit','id'), COALESCE((SELECT MAX(id) FROM audit), 1), true)`;
  });

  for (const [sourceTable, targetTable] of tableMap) {
    const sourceCount = Number(
      (source.prepare(`SELECT COUNT(*) AS count FROM ${quoteIdentifier(sourceTable)}`).get() as { count: number }).count,
    );
    const [{ count: targetCount }] = await sql.unsafe(
      `SELECT COUNT(*)::int AS count FROM ${quoteIdentifier(targetTable)}`,
    );
    if (sourceCount !== Number(targetCount)) {
      throw new Error(`${sourceTable} verification failed: SQLite=${sourceCount}, PostgreSQL=${targetCount}`);
    }
    process.stdout.write(`verified ${targetTable}: ${targetCount}\n`);
  }
} finally {
  source.close();
  await sql.end();
}

function quoteIdentifier(value: string): string {
  return `"${value.replaceAll('"', '""')}"`;
}
