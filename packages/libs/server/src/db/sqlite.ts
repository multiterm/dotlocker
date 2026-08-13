// #region -- SQLite Init + Migrations ----------------------

import Database from "better-sqlite3";

export type DB = Database.Database;

export function openDb(path: string): DB {
  const db = new Database(path);
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");
  db.pragma("synchronous = NORMAL");
  migrate(db);
  return db;
}

function migrate(db: DB): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_version (
      version INTEGER PRIMARY KEY
    );

    CREATE TABLE IF NOT EXISTS orgs (
      name        TEXT PRIMARY KEY,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS users (
      email        TEXT PRIMARY KEY,
      password_hash TEXT NOT NULL,
      password_salt TEXT NOT NULL,
      verified_at INTEGER,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS services (
      org             TEXT NOT NULL REFERENCES orgs(name) ON DELETE CASCADE,
      name            TEXT NOT NULL,
      owner_email     TEXT REFERENCES users(email),
      allowed_sources TEXT NOT NULL DEFAULT '[]',
      created_at      INTEGER NOT NULL,
      updated_at      INTEGER NOT NULL,
      PRIMARY KEY (org, name)
    );

    CREATE TABLE IF NOT EXISTS tokens (
      id          TEXT PRIMARY KEY,
      org         TEXT NOT NULL REFERENCES orgs(name) ON DELETE CASCADE,
      hash        TEXT NOT NULL,
      salt        TEXT NOT NULL,
      scopes      TEXT NOT NULL,
      label       TEXT NOT NULL DEFAULT '',
      user_email  TEXT REFERENCES users(email),
      service     TEXT,
      created_at  INTEGER NOT NULL,
      expires_at  INTEGER,
      revoked_at  INTEGER
    );

    CREATE INDEX IF NOT EXISTS tokens_org ON tokens(org);

    CREATE TABLE IF NOT EXISTS audit (
      id          INTEGER PRIMARY KEY AUTOINCREMENT,
      ts          INTEGER NOT NULL,
      org         TEXT NOT NULL,
      token_id    TEXT,
      action      TEXT NOT NULL,
      path        TEXT NOT NULL,
      status      INTEGER NOT NULL,
      ip          TEXT,
      warning     TEXT
    );

    CREATE INDEX IF NOT EXISTS audit_org_ts ON audit(org, ts);

    CREATE TABLE IF NOT EXISTS org_memberships (
      email      TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      org        TEXT NOT NULL REFERENCES orgs(name) ON DELETE CASCADE,
      role       TEXT NOT NULL CHECK(role IN ('org_admin')),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (email, org)
    );

    CREATE TABLE IF NOT EXISTS repo_grants (
      email      TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      org        TEXT NOT NULL REFERENCES orgs(name) ON DELETE CASCADE,
      repo       TEXT NOT NULL,
      access     TEXT NOT NULL CHECK(access IN ('read', 'write', 'admin')),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (email, org, repo)
    );

    CREATE TABLE IF NOT EXISTS runtime_grants (
      email      TEXT NOT NULL REFERENCES users(email) ON DELETE CASCADE,
      org        TEXT NOT NULL REFERENCES orgs(name) ON DELETE CASCADE,
      repo       TEXT NOT NULL,
      runtime    TEXT NOT NULL,
      access     TEXT NOT NULL CHECK(access IN ('read', 'write', 'admin')),
      created_at INTEGER NOT NULL,
      PRIMARY KEY (email, org, repo, runtime)
    );

    CREATE TABLE IF NOT EXISTS file_records (
      path        TEXT PRIMARY KEY,
      org         TEXT NOT NULL REFERENCES orgs(name) ON DELETE CASCADE,
      repo        TEXT NOT NULL,
      runtime     TEXT NOT NULL,
      rel_path    TEXT NOT NULL,
      size        INTEGER NOT NULL,
      sha256      TEXT NOT NULL,
      uploaded_by TEXT REFERENCES users(email),
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      deleted_at  INTEGER
    );

    CREATE INDEX IF NOT EXISTS file_records_org_repo_runtime ON file_records(org, repo, runtime, deleted_at);

    CREATE TABLE IF NOT EXISTS public_files (
      id          TEXT PRIMARY KEY,
      path        TEXT NOT NULL UNIQUE REFERENCES file_records(path) ON DELETE CASCADE,
      org         TEXT NOT NULL REFERENCES orgs(name) ON DELETE CASCADE,
      created_at  INTEGER NOT NULL,
      created_by  TEXT REFERENCES users(email)
    );

    CREATE INDEX IF NOT EXISTS public_files_org ON public_files(org, created_at);

    CREATE TABLE IF NOT EXISTS runtime_versions (
      hash        TEXT PRIMARY KEY,
      short_hash  TEXT NOT NULL,
      tree_hash   TEXT NOT NULL,
      parent_hash TEXT REFERENCES runtime_versions(hash),
      org         TEXT NOT NULL REFERENCES orgs(name) ON DELETE CASCADE,
      repo        TEXT NOT NULL,
      runtime     TEXT NOT NULL,
      created_at  INTEGER NOT NULL,
      created_by  TEXT REFERENCES users(email)
    );

    CREATE INDEX IF NOT EXISTS runtime_versions_history
      ON runtime_versions(org, repo, runtime, created_at DESC);
    CREATE INDEX IF NOT EXISTS runtime_versions_short_hash ON runtime_versions(short_hash);

    CREATE TABLE IF NOT EXISTS runtime_version_files (
      version_hash TEXT NOT NULL REFERENCES runtime_versions(hash) ON DELETE CASCADE,
      path         TEXT NOT NULL,
      sha256       TEXT NOT NULL,
      size         INTEGER NOT NULL,
      PRIMARY KEY (version_hash, path)
    );

    CREATE TABLE IF NOT EXISTS runtime_heads (
      org          TEXT NOT NULL REFERENCES orgs(name) ON DELETE CASCADE,
      repo         TEXT NOT NULL,
      runtime      TEXT NOT NULL,
      version_hash TEXT NOT NULL REFERENCES runtime_versions(hash),
      PRIMARY KEY (org, repo, runtime)
    );

    CREATE TABLE IF NOT EXISTS webhook_endpoints (
      id                TEXT PRIMARY KEY,
      org               TEXT NOT NULL REFERENCES orgs(name) ON DELETE CASCADE,
      name              TEXT NOT NULL,
      url               TEXT NOT NULL,
      events            TEXT NOT NULL,
      signing_secret    TEXT NOT NULL,
      enabled           INTEGER NOT NULL DEFAULT 1,
      created_at        INTEGER NOT NULL,
      updated_at        INTEGER NOT NULL,
      last_delivered_at INTEGER,
      last_status       INTEGER
    );

    CREATE INDEX IF NOT EXISTS webhook_endpoints_org ON webhook_endpoints(org, created_at);

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id              TEXT PRIMARY KEY,
      webhook_id      TEXT NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE,
      event           TEXT NOT NULL,
      payload         TEXT NOT NULL,
      status          TEXT NOT NULL,
      response_status INTEGER,
      error           TEXT,
      created_at      INTEGER NOT NULL,
      completed_at    INTEGER
    );

    CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint
      ON webhook_deliveries(webhook_id, created_at DESC);

    INSERT OR IGNORE INTO schema_version (version) VALUES (1);
    INSERT OR IGNORE INTO schema_version (version) VALUES (2);
    INSERT OR IGNORE INTO schema_version (version) VALUES (3);
  `);

  ensureColumn(db, "tokens", "user_email", "TEXT REFERENCES users(email)");
  ensureColumn(db, "tokens", "service", "TEXT");
  ensureColumn(db, "users", "totp_secret", "TEXT");
  ensureColumn(db, "users", "totp_enabled_at", "INTEGER");
  ensureColumn(db, "users", "keyname_subject", "TEXT");
  ensureColumn(db, "audit", "warning", "TEXT");
  db.exec("CREATE INDEX IF NOT EXISTS tokens_service ON tokens(org, service)");
  db.exec(
    "CREATE UNIQUE INDEX IF NOT EXISTS users_keyname_subject ON users(keyname_subject) WHERE keyname_subject IS NOT NULL",
  );
}

function ensureColumn(db: DB, table: string, column: string, definition: string): void {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as readonly { name: string }[];
  if (rows.some((r) => r.name === column)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// #endregion ------------------------------------------------
