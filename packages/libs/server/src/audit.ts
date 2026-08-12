// #region -- Audit log -------------------------------------

import type { DB } from "./db.js";
import { queueWebhookEvent } from "./webhooks.js";

export type AuditAction =
  | "get"
  | "put"
  | "delete"
  | "deny"
  | "auth_fail"
  | "resolve"
  | "version"
  | "auth"
  | "org"
  | "token"
  | "grant"
  | "webhook"
  | "user"
  | "health"
  | "warning";

export interface AuditEntry {
  readonly ts?: number;
  readonly org: string;
  readonly tokenId: string | null;
  readonly action: AuditAction;
  readonly path: string;
  readonly status: number;
  readonly ip: string | null;
  readonly warning?: string | null;
}

export function recordAudit(db: DB, entry: AuditEntry): void {
  db.prepare(
    `INSERT INTO audit (ts, org, token_id, action, path, status, ip, warning)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    Date.now(),
    entry.org,
    entry.tokenId,
    entry.action,
    entry.path,
    entry.status,
    entry.ip,
    entry.warning ?? null,
  );
  queueWebhookEvent(db, entry);
}

export function recentAudit(db: DB, org: string, limit = 100): readonly AuditEntry[] {
  const rows = db
    .prepare(
      `SELECT ts, org, token_id, action, path, status, ip, warning
       FROM audit WHERE org = ? ORDER BY ts DESC LIMIT ?`,
    )
    .all(org, limit) as readonly {
    ts: number;
    org: string;
    token_id: string | null;
    action: AuditAction;
    path: string;
    status: number;
    ip: string | null;
    warning: string | null;
  }[];
  return rows.map((r) => ({
    ts: r.ts,
    org: r.org,
    tokenId: r.token_id,
    action: r.action,
    path: r.path,
    status: r.status,
    ip: r.ip,
    warning: r.warning,
  }));
}

// #endregion ------------------------------------------------
