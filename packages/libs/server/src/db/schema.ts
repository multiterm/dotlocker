// #region -- Drizzle/Postgres schema -----------------------

import {
  bigint,
  index,
  integer,
  pgTable,
  primaryKey,
  text,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const orgs = pgTable("orgs", {
  name: text("name").primaryKey(),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
});

export const users = pgTable("users", {
  email: text("email").primaryKey(),
  passwordHash: text("password_hash").notNull(),
  passwordSalt: text("password_salt").notNull(),
  verifiedAt: bigint("verified_at", { mode: "number" }),
  createdAt: bigint("created_at", { mode: "number" }).notNull(),
  totpSecret: text("totp_secret"),
  totpEnabledAt: bigint("totp_enabled_at", { mode: "number" }),
  keynameSubject: text("keyname_subject").unique(),
});

export const authTokens = pgTable(
  "auth_tokens",
  {
    id: text("id").primaryKey(),
    userEmail: text("user_email")
      .notNull()
      .references(() => users.email, { onDelete: "cascade" }),
    org: text("org")
      .notNull()
      .references(() => orgs.name, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    salt: text("salt").notNull(),
    label: text("label").notNull().default(""),
    scopes: text("scopes").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }),
    revokedAt: bigint("revoked_at", { mode: "number" }),
  },
  (t) => ({
    userIdx: index("auth_tokens_user_idx").on(t.userEmail),
    orgIdx: index("auth_tokens_org_idx").on(t.org),
  }),
);

export const refreshTokens = pgTable(
  "refresh_tokens",
  {
    id: text("id").primaryKey(),
    authTokenId: text("auth_token_id").references(() => authTokens.id, { onDelete: "cascade" }),
    userEmail: text("user_email")
      .notNull()
      .references(() => users.email, { onDelete: "cascade" }),
    org: text("org")
      .notNull()
      .references(() => orgs.name, { onDelete: "cascade" }),
    hash: text("hash").notNull(),
    salt: text("salt").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    expiresAt: bigint("expires_at", { mode: "number" }).notNull(),
    revokedAt: bigint("revoked_at", { mode: "number" }),
  },
  (t) => ({
    userIdx: index("refresh_tokens_user_idx").on(t.userEmail),
    authIdx: index("refresh_tokens_auth_idx").on(t.authTokenId),
  }),
);

export const orgMemberships = pgTable(
  "org_memberships",
  {
    email: text("email")
      .notNull()
      .references(() => users.email, { onDelete: "cascade" }),
    org: text("org")
      .notNull()
      .references(() => orgs.name, { onDelete: "cascade" }),
    role: text("role").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.email, t.org] }) }),
);

export const repoGrants = pgTable(
  "repo_grants",
  {
    email: text("email")
      .notNull()
      .references(() => users.email, { onDelete: "cascade" }),
    org: text("org")
      .notNull()
      .references(() => orgs.name, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    access: text("access").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.email, t.org, t.repo] }) }),
);

export const runtimeGrants = pgTable(
  "runtime_grants",
  {
    email: text("email")
      .notNull()
      .references(() => users.email, { onDelete: "cascade" }),
    org: text("org")
      .notNull()
      .references(() => orgs.name, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    runtime: text("runtime").notNull(),
    access: text("access").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.email, t.org, t.repo, t.runtime] }) }),
);

export const fileRecords = pgTable(
  "file_records",
  {
    path: text("path").primaryKey(),
    org: text("org")
      .notNull()
      .references(() => orgs.name, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    runtime: text("runtime").notNull(),
    relPath: text("rel_path").notNull(),
    size: integer("size").notNull(),
    sha256: text("sha256").notNull(),
    uploadedBy: text("uploaded_by").references(() => users.email),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    deletedAt: bigint("deleted_at", { mode: "number" }),
  },
  (t) => ({
    visibleIdx: index("file_records_org_repo_runtime_idx").on(
      t.org,
      t.repo,
      t.runtime,
      t.deletedAt,
    ),
  }),
);

export const runtimeVersions = pgTable(
  "runtime_versions",
  {
    hash: text("hash").primaryKey(),
    shortHash: text("short_hash").notNull(),
    treeHash: text("tree_hash").notNull(),
    parentHash: text("parent_hash"),
    org: text("org").notNull().references(() => orgs.name, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    runtime: text("runtime").notNull(),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    createdBy: text("created_by").references(() => users.email),
  },
  (t) => ({ historyIdx: index("runtime_versions_history_idx").on(t.org, t.repo, t.runtime, t.createdAt) }),
);

export const runtimeVersionFiles = pgTable(
  "runtime_version_files",
  {
    versionHash: text("version_hash").notNull().references(() => runtimeVersions.hash, { onDelete: "cascade" }),
    path: text("path").notNull(),
    sha256: text("sha256").notNull(),
    size: integer("size").notNull(),
  },
  (t) => ({ pk: primaryKey({ columns: [t.versionHash, t.path] }) }),
);

export const runtimeHeads = pgTable(
  "runtime_heads",
  {
    org: text("org").notNull().references(() => orgs.name, { onDelete: "cascade" }),
    repo: text("repo").notNull(),
    runtime: text("runtime").notNull(),
    versionHash: text("version_hash").notNull().references(() => runtimeVersions.hash),
  },
  (t) => ({ pk: primaryKey({ columns: [t.org, t.repo, t.runtime] }) }),
);

export const webhookEndpoints = pgTable(
  "webhook_endpoints",
  {
    id: text("id").primaryKey(),
    org: text("org").notNull().references(() => orgs.name, { onDelete: "cascade" }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    events: text("events").notNull(),
    signingSecret: text("signing_secret").notNull(),
    enabled: integer("enabled").notNull().default(1),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
    lastDeliveredAt: bigint("last_delivered_at", { mode: "number" }),
    lastStatus: integer("last_status"),
  },
  (t) => ({ orgIdx: index("webhook_endpoints_org_idx").on(t.org, t.createdAt) }),
);

export const webhookDeliveries = pgTable(
  "webhook_deliveries",
  {
    id: text("id").primaryKey(),
    webhookId: text("webhook_id").notNull().references(() => webhookEndpoints.id, { onDelete: "cascade" }),
    event: text("event").notNull(),
    payload: text("payload").notNull(),
    status: text("status").notNull(),
    responseStatus: integer("response_status"),
    error: text("error"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    completedAt: bigint("completed_at", { mode: "number" }),
  },
  (t) => ({ endpointIdx: index("webhook_deliveries_endpoint_idx").on(t.webhookId, t.createdAt) }),
);

export const audit = pgTable(
  "audit",
  {
    id: bigint("id", { mode: "number" }).primaryKey(),
    ts: bigint("ts", { mode: "number" }).notNull(),
    org: text("org").notNull(),
    tokenId: text("token_id"),
    action: text("action").notNull(),
    path: text("path").notNull(),
    status: integer("status").notNull(),
    ip: text("ip"),
    warning: text("warning"),
  },
  (t) => ({ orgTsIdx: index("audit_org_ts_idx").on(t.org, t.ts) }),
);

export const services = pgTable(
  "services",
  {
    org: text("org")
      .notNull()
      .references(() => orgs.name, { onDelete: "cascade" }),
    name: text("name").notNull(),
    ownerEmail: text("owner_email").references(() => users.email),
    allowedSources: text("allowed_sources").notNull().default("[]"),
    createdAt: bigint("created_at", { mode: "number" }).notNull(),
    updatedAt: bigint("updated_at", { mode: "number" }).notNull(),
  },
  (t) => ({
    pk: primaryKey({ columns: [t.org, t.name] }),
    nameIdx: uniqueIndex("services_org_name_idx").on(t.org, t.name),
  }),
);

// #endregion ------------------------------------------------
