// #region -- Organization webhooks ------------------------

import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { DB } from "./db.js";
import type { AuditEntry } from "./audit.js";
import { InvalidPathError, NotFoundError } from "@multiterm/pluto-shared";

export interface WebhookRecord {
  readonly id: string;
  readonly org: string;
  readonly name: string;
  readonly url: string;
  readonly events: readonly string[];
  readonly enabled: boolean;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly lastDeliveredAt: number | null;
  readonly lastStatus: number | null;
}

export interface WebhookDelivery {
  readonly id: string;
  readonly webhookId: string;
  readonly event: string;
  readonly status: "pending" | "delivered" | "failed";
  readonly responseStatus: number | null;
  readonly error: string | null;
  readonly createdAt: number;
  readonly completedAt: number | null;
}

export function listWebhooks(db: DB, org: string): readonly WebhookRecord[] {
  const rows = db
    .prepare("SELECT * FROM webhook_endpoints WHERE org = ? ORDER BY created_at DESC")
    .all(org) as WebhookRow[];
  return rows.map(rowToWebhook);
}

export function createWebhook(
  db: DB,
  input: { org: string; name: string; url: string; events: readonly string[] },
): { webhook: WebhookRecord; secret: string } {
  const name = input.name.trim();
  if (!name || name.length > 100) throw new InvalidPathError("invalid webhook name", name);
  const url = normalizeWebhookUrl(input.url);
  const events = normalizeEvents(input.events);
  const id = `whk_${randomBytes(12).toString("base64url")}`;
  const secret = `plwhsec_${randomBytes(32).toString("base64url")}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO webhook_endpoints
     (id, org, name, url, events, signing_secret, enabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)`,
  ).run(id, input.org, name, url, JSON.stringify(events), secret, now, now);
  return { webhook: getWebhook(db, input.org, id), secret };
}

export function updateWebhook(
  db: DB,
  org: string,
  id: string,
  patch: { name?: string; url?: string; events?: readonly string[]; enabled?: boolean },
): WebhookRecord {
  const current = getWebhook(db, org, id);
  const name = patch.name === undefined ? current.name : patch.name.trim();
  if (!name || name.length > 100) throw new InvalidPathError("invalid webhook name", name);
  const url = patch.url === undefined ? current.url : normalizeWebhookUrl(patch.url);
  const events = patch.events === undefined ? current.events : normalizeEvents(patch.events);
  const enabled = patch.enabled === undefined ? current.enabled : patch.enabled;
  db.prepare(
    `UPDATE webhook_endpoints
     SET name = ?, url = ?, events = ?, enabled = ?, updated_at = ?
     WHERE id = ? AND org = ?`,
  ).run(name, url, JSON.stringify(events), enabled ? 1 : 0, Date.now(), id, org);
  return getWebhook(db, org, id);
}

export function deleteWebhook(db: DB, org: string, id: string): void {
  const result = db.prepare("DELETE FROM webhook_endpoints WHERE id = ? AND org = ?").run(id, org);
  if (result.changes === 0) throw new NotFoundError("webhook not found");
}

export function listWebhookDeliveries(
  db: DB,
  org: string,
  webhookId: string,
  limit = 50,
): readonly WebhookDelivery[] {
  getWebhook(db, org, webhookId);
  const rows = db
    .prepare(
      `SELECT d.* FROM webhook_deliveries d
       JOIN webhook_endpoints w ON w.id = d.webhook_id
       WHERE d.webhook_id = ? AND w.org = ?
       ORDER BY d.created_at DESC LIMIT ?`,
    )
    .all(webhookId, org, Math.max(1, Math.min(200, limit))) as DeliveryRow[];
  return rows.map(rowToDelivery);
}

export function queueWebhookEvent(db: DB, entry: AuditEntry): void {
  if (entry.org === "-") return;
  const rows = db
    .prepare("SELECT * FROM webhook_endpoints WHERE org = ? AND enabled = 1")
    .all(entry.org) as WebhookRow[];
  for (const row of rows) {
    const events = JSON.parse(row.events) as string[];
    if (!events.includes("*") && !events.includes(entry.action)) continue;
    const deliveryId = `whd_${randomUUID()}`;
    const createdAt = Date.now();
    const payload = JSON.stringify({
      id: deliveryId,
      event: `pluto.${entry.action}`,
      createdAt,
      org: entry.org,
      data: {
        tokenId: entry.tokenId,
        action: entry.action,
        path: entry.path,
        status: entry.status,
        ip: entry.ip,
        warning: entry.warning ?? null,
      },
    });
    db.prepare(
      `INSERT INTO webhook_deliveries
       (id, webhook_id, event, payload, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', ?)`,
    ).run(deliveryId, row.id, entry.action, payload, createdAt);
    queueMicrotask(() => void deliver(db, row, deliveryId, payload));
  }
}

function getWebhook(db: DB, org: string, id: string): WebhookRecord {
  const row = db
    .prepare("SELECT * FROM webhook_endpoints WHERE id = ? AND org = ?")
    .get(id, org) as WebhookRow | undefined;
  if (!row) throw new NotFoundError("webhook not found");
  return rowToWebhook(row);
}

async function deliver(
  db: DB,
  webhook: WebhookRow,
  deliveryId: string,
  payload: string,
): Promise<void> {
  const timestamp = Math.floor(Date.now() / 1000).toString();
  const signature = createHmac("sha256", webhook.signing_secret)
    .update(`${timestamp}.${payload}`)
    .digest("hex");
  let responseStatus: number | null = null;
  let error: string | null = null;
  try {
    const response = await fetch(webhook.url, {
      method: "POST",
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
      headers: {
        "content-type": "application/json",
        "user-agent": "Pluto-Webhooks/1.0",
        "x-pluto-delivery": deliveryId,
        "x-pluto-event": `pluto.${JSON.parse(payload).data.action}`,
        "x-pluto-timestamp": timestamp,
        "x-pluto-signature": `sha256=${signature}`,
      },
      body: payload,
    });
    responseStatus = response.status;
    if (!response.ok) error = `HTTP ${response.status}`;
  } catch (reason) {
    error = reason instanceof Error ? reason.message.slice(0, 500) : "delivery failed";
  }
  const completedAt = Date.now();
  const status = error ? "failed" : "delivered";
  try {
    db.prepare(
      `UPDATE webhook_deliveries
       SET status = ?, response_status = ?, error = ?, completed_at = ? WHERE id = ?`,
    ).run(status, responseStatus, error, completedAt, deliveryId);
    db.prepare(
      `UPDATE webhook_endpoints
       SET last_delivered_at = ?, last_status = ?, updated_at = updated_at WHERE id = ?`,
    ).run(completedAt, responseStatus, webhook.id);
  } catch {
    // The process may be shutting down and closing the local database.
  }
}

function normalizeWebhookUrl(input: string): string {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    throw new InvalidPathError("invalid webhook URL", input);
  }
  const localhost =
    url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if (url.protocol !== "https:" && !(process.env.NODE_ENV !== "production" && localhost))
    throw new InvalidPathError("webhooks require HTTPS", input);
  url.username = "";
  url.password = "";
  url.hash = "";
  return url.toString();
}

function normalizeEvents(input: readonly string[]): string[] {
  const allowed = new Set([
    "*",
    "get",
    "put",
    "delete",
    "deny",
    "auth_fail",
    "resolve",
    "version",
    "warning",
    "auth",
    "org",
    "token",
    "grant",
    "webhook",
    "user",
  ]);
  const events = [...new Set(input)].filter((event) => allowed.has(event));
  if (!events.length || events.length !== input.length)
    throw new InvalidPathError("invalid webhook events", input.join(","));
  return events.sort();
}

function rowToWebhook(row: WebhookRow): WebhookRecord {
  return {
    id: row.id,
    org: row.org,
    name: row.name,
    url: row.url,
    events: JSON.parse(row.events) as string[],
    enabled: Boolean(row.enabled),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastDeliveredAt: row.last_delivered_at,
    lastStatus: row.last_status,
  };
}

function rowToDelivery(row: DeliveryRow): WebhookDelivery {
  return {
    id: row.id,
    webhookId: row.webhook_id,
    event: row.event,
    status: row.status,
    responseStatus: row.response_status,
    error: row.error,
    createdAt: row.created_at,
    completedAt: row.completed_at,
  };
}

interface WebhookRow {
  id: string;
  org: string;
  name: string;
  url: string;
  events: string;
  signing_secret: string;
  enabled: number;
  created_at: number;
  updated_at: number;
  last_delivered_at: number | null;
  last_status: number | null;
}

interface DeliveryRow {
  id: string;
  webhook_id: string;
  event: string;
  status: "pending" | "delivered" | "failed";
  response_status: number | null;
  error: string | null;
  created_at: number;
  completed_at: number | null;
}

// #endregion ------------------------------------------------
