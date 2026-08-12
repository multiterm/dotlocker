// #region -- Postgres migrations ---------------------------

import postgres from "postgres";

export async function migratePostgres(sql: postgres.Sql): Promise<void> {
  await sql.begin(async (tx) => {
    await tx`CREATE TABLE IF NOT EXISTS orgs (name text PRIMARY KEY, created_at bigint NOT NULL)`;
    await tx`CREATE TABLE IF NOT EXISTS users (email text PRIMARY KEY, password_hash text NOT NULL, password_salt text NOT NULL, verified_at bigint, created_at bigint NOT NULL, totp_secret text, totp_enabled_at bigint, keyname_subject text)`;
    await tx`ALTER TABLE users ADD COLUMN IF NOT EXISTS keyname_subject text`;
    await tx`CREATE UNIQUE INDEX IF NOT EXISTS users_keyname_subject_idx ON users(keyname_subject) WHERE keyname_subject IS NOT NULL`;
    await tx`CREATE TABLE IF NOT EXISTS services (org text NOT NULL REFERENCES orgs(name) ON DELETE CASCADE, name text NOT NULL, owner_email text REFERENCES users(email), allowed_sources text NOT NULL DEFAULT '[]', created_at bigint NOT NULL, updated_at bigint NOT NULL, PRIMARY KEY (org, name))`;
    await tx`CREATE TABLE IF NOT EXISTS auth_tokens (id text PRIMARY KEY, org text NOT NULL REFERENCES orgs(name) ON DELETE CASCADE, hash text NOT NULL, salt text NOT NULL, scopes text NOT NULL, label text NOT NULL DEFAULT '', user_email text REFERENCES users(email), service text, created_at bigint NOT NULL, expires_at bigint, revoked_at bigint)`;
    await tx`CREATE INDEX IF NOT EXISTS auth_tokens_org_idx ON auth_tokens(org)`;
    await tx`CREATE INDEX IF NOT EXISTS auth_tokens_user_idx ON auth_tokens(user_email)`;
    await tx`CREATE TABLE IF NOT EXISTS refresh_tokens (id text PRIMARY KEY, auth_token_id text REFERENCES auth_tokens(id) ON DELETE CASCADE, user_email text NOT NULL REFERENCES users(email) ON DELETE CASCADE, org text NOT NULL REFERENCES orgs(name) ON DELETE CASCADE, hash text NOT NULL, salt text NOT NULL, created_at bigint NOT NULL, expires_at bigint NOT NULL, revoked_at bigint)`;
    await tx`CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens(user_email)`;
    await tx`CREATE INDEX IF NOT EXISTS refresh_tokens_auth_idx ON refresh_tokens(auth_token_id)`;
    await tx`CREATE TABLE IF NOT EXISTS audit (id bigserial PRIMARY KEY, ts bigint NOT NULL, org text NOT NULL, token_id text, action text NOT NULL, path text NOT NULL, status integer NOT NULL, ip text, warning text)`;
    await tx`CREATE INDEX IF NOT EXISTS audit_org_ts_idx ON audit(org, ts)`;
    await tx`CREATE TABLE IF NOT EXISTS org_memberships (email text NOT NULL REFERENCES users(email) ON DELETE CASCADE, org text NOT NULL REFERENCES orgs(name) ON DELETE CASCADE, role text NOT NULL CHECK(role IN ('org_admin')), created_at bigint NOT NULL, PRIMARY KEY (email, org))`;
    await tx`CREATE TABLE IF NOT EXISTS repo_grants (email text NOT NULL REFERENCES users(email) ON DELETE CASCADE, org text NOT NULL REFERENCES orgs(name) ON DELETE CASCADE, repo text NOT NULL, access text NOT NULL CHECK(access IN ('read','write','admin')), created_at bigint NOT NULL, PRIMARY KEY (email, org, repo))`;
    await tx`CREATE TABLE IF NOT EXISTS runtime_grants (email text NOT NULL REFERENCES users(email) ON DELETE CASCADE, org text NOT NULL REFERENCES orgs(name) ON DELETE CASCADE, repo text NOT NULL, runtime text NOT NULL, access text NOT NULL CHECK(access IN ('read','write','admin')), created_at bigint NOT NULL, PRIMARY KEY (email, org, repo, runtime))`;
    await tx`CREATE TABLE IF NOT EXISTS file_records (path text PRIMARY KEY, org text NOT NULL REFERENCES orgs(name) ON DELETE CASCADE, repo text NOT NULL, runtime text NOT NULL, rel_path text NOT NULL, size integer NOT NULL, sha256 text NOT NULL, uploaded_by text REFERENCES users(email), created_at bigint NOT NULL, updated_at bigint NOT NULL, deleted_at bigint)`;
    await tx`CREATE INDEX IF NOT EXISTS file_records_org_repo_runtime_idx ON file_records(org, repo, runtime, deleted_at)`;
    await tx`CREATE TABLE IF NOT EXISTS runtime_versions (hash text PRIMARY KEY, short_hash text NOT NULL, tree_hash text NOT NULL, parent_hash text REFERENCES runtime_versions(hash), org text NOT NULL REFERENCES orgs(name) ON DELETE CASCADE, repo text NOT NULL, runtime text NOT NULL, created_at bigint NOT NULL, created_by text REFERENCES users(email))`;
    await tx`CREATE INDEX IF NOT EXISTS runtime_versions_history_idx ON runtime_versions(org, repo, runtime, created_at DESC)`;
    await tx`CREATE INDEX IF NOT EXISTS runtime_versions_short_hash_idx ON runtime_versions(short_hash)`;
    await tx`CREATE TABLE IF NOT EXISTS runtime_version_files (version_hash text NOT NULL REFERENCES runtime_versions(hash) ON DELETE CASCADE, path text NOT NULL, sha256 text NOT NULL, size integer NOT NULL, PRIMARY KEY (version_hash, path))`;
    await tx`CREATE TABLE IF NOT EXISTS runtime_heads (org text NOT NULL REFERENCES orgs(name) ON DELETE CASCADE, repo text NOT NULL, runtime text NOT NULL, version_hash text NOT NULL REFERENCES runtime_versions(hash), PRIMARY KEY (org, repo, runtime))`;
    await tx`CREATE TABLE IF NOT EXISTS webhook_endpoints (id text PRIMARY KEY, org text NOT NULL REFERENCES orgs(name) ON DELETE CASCADE, name text NOT NULL, url text NOT NULL, events text NOT NULL, signing_secret text NOT NULL, enabled integer NOT NULL DEFAULT 1, created_at bigint NOT NULL, updated_at bigint NOT NULL, last_delivered_at bigint, last_status integer)`;
    await tx`CREATE INDEX IF NOT EXISTS webhook_endpoints_org_idx ON webhook_endpoints(org, created_at)`;
    await tx`CREATE TABLE IF NOT EXISTS webhook_deliveries (id text PRIMARY KEY, webhook_id text NOT NULL REFERENCES webhook_endpoints(id) ON DELETE CASCADE, event text NOT NULL, payload text NOT NULL, status text NOT NULL, response_status integer, error text, created_at bigint NOT NULL, completed_at bigint)`;
    await tx`CREATE INDEX IF NOT EXISTS webhook_deliveries_endpoint_idx ON webhook_deliveries(webhook_id, created_at DESC)`;
  });
}

// #endregion ------------------------------------------------
