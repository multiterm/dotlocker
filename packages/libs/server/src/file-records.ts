// #region -- File metadata records -------------------------

import { createHash } from "node:crypto";
import type { DB } from "./db.js";
import { normalizePath } from "@multiterm/pluto-shared";

export interface FileRecord {
  readonly path: string;
  readonly org: string;
  readonly repo: string;
  readonly runtime: string;
  readonly relPath: string;
  readonly size: number;
  readonly sha256: string;
  readonly uploadedBy: string | null;
  readonly createdAt: number;
  readonly updatedAt: number;
  readonly deletedAt: number | null;
}

export function upsertFileRecord(
  db: DB,
  storagePath: string,
  body: Buffer,
  uploadedBy: string | null,
): FileRecord | null {
  const n = normalizePath(storagePath);
  const [org, repo, runtime, ...rest] = n.segments;
  if (!repo || !runtime || rest.length === 0) return null;
  const now = Date.now();
  const sha256 = createHash("sha256").update(body).digest("hex");
  db.prepare(
    `INSERT INTO file_records (path, org, repo, runtime, rel_path, size, sha256, uploaded_by, created_at, updated_at, deleted_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL)
     ON CONFLICT(path) DO UPDATE SET
       size = excluded.size,
       sha256 = excluded.sha256,
       uploaded_by = excluded.uploaded_by,
       updated_at = excluded.updated_at,
       deleted_at = NULL`,
  ).run(n.joined, org, repo, runtime, rest.join("/"), body.length, sha256, uploadedBy, now, now);
  return getFileRecord(db, n.joined)!;
}

export function markFileDeleted(db: DB, storagePath: string): void {
  const n = normalizePath(storagePath);
  db.prepare("UPDATE file_records SET deleted_at = ?, updated_at = ? WHERE path = ?").run(
    Date.now(),
    Date.now(),
    n.joined,
  );
}

export function getFileRecord(db: DB, storagePath: string): FileRecord | null {
  const row = db
    .prepare("SELECT * FROM file_records WHERE path = ?")
    .get(normalizePath(storagePath).joined) as Row | undefined;
  return row ? rowToRecord(row) : null;
}

export function listFileRecords(
  db: DB,
  org: string,
  repo?: string,
  runtime?: string,
): readonly FileRecord[] {
  const clauses = ["org = ?", "deleted_at IS NULL"];
  const args: unknown[] = [org];
  if (repo) {
    clauses.push("repo = ?");
    args.push(repo);
  }
  if (runtime) {
    clauses.push("runtime = ?");
    args.push(runtime);
  }
  const rows = db
    .prepare(`SELECT * FROM file_records WHERE ${clauses.join(" AND ")} ORDER BY path`)
    .all(...args) as Row[];
  return rows.map(rowToRecord);
}

interface Row {
  readonly path: string;
  readonly org: string;
  readonly repo: string;
  readonly runtime: string;
  readonly rel_path: string;
  readonly size: number;
  readonly sha256: string;
  readonly uploaded_by: string | null;
  readonly created_at: number;
  readonly updated_at: number;
  readonly deleted_at: number | null;
}

function rowToRecord(row: Row): FileRecord {
  return {
    path: row.path,
    org: row.org,
    repo: row.repo,
    runtime: row.runtime,
    relPath: row.rel_path,
    size: row.size,
    sha256: row.sha256,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    deletedAt: row.deleted_at,
  };
}

// #endregion ------------------------------------------------
