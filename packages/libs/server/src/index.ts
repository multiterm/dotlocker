// #region -- Server-side public surface --------------------

export { openDb } from "./db.js";
export type { DB } from "./db.js";
export { openPostgresDb } from "./db/postgres.js";
export type { PgDB } from "./db/postgres.js";

export {
  createUser,
  verifyUserEmail,
  getUser,
  listUsers,
  assertUserPassword,
  beginTotpSetup,
  enableTotp,
  isTotpEnabled,
  verifyTotpForUser,
} from "./users.js";
export type { UserRecord, CreateUserInput } from "./users.js";

export {
  upsertService,
  getService,
  maybeGetService,
  listServices,
  serviceWarningForRequest,
} from "./services.js";
export type { ServiceRecord, UpsertServiceInput } from "./services.js";

export { createOrg, listOrgs, mintToken, verifyToken, listTokens, revokeToken } from "./tokens.js";
export type { TokenRecord, MintTokenInput, MintTokenResult } from "./tokens.js";

export { FileStore } from "./files.js";
export type { FileStoreOptions } from "./files.js";

export {
  grantOrgAdmin,
  grantRepo,
  grantRuntime,
  listOrgGrants,
  listUserGrants,
  revokeGrant,
  authorizeGrant,
  isOrgAdmin,
} from "./grants.js";
export type { GrantAccess, GrantRecord } from "./grants.js";

export {
  upsertFileRecord,
  getFileRecord,
  listFileRecords,
  markFileDeleted,
} from "./file-records.js";
export type { FileRecord } from "./file-records.js";

export {
  commitRuntimeVersion,
  getRuntimeHead,
  getRuntimeHeadFile,
  hasRuntimeHead,
  listCommittedStoragePaths,
  listRuntimeVersions,
  SHORT_VERSION_LENGTH,
} from "./runtime-versions.js";
export type { RuntimeVersion, RuntimeVersionFile, CommitRuntimeVersionResult } from "./runtime-versions.js";

export { recordAudit, recentAudit } from "./audit.js";
export type { AuditAction, AuditEntry } from "./audit.js";

export {
  createWebhook,
  updateWebhook,
  deleteWebhook,
  listWebhooks,
  listWebhookDeliveries,
} from "./webhooks.js";
export type { WebhookRecord, WebhookDelivery } from "./webhooks.js";

export { buildServer, type BuildServerOptions } from "./http.js";

export { operatorCommands } from "./cli.js";

// #endregion ------------------------------------------------
