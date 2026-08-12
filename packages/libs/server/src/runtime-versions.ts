// #region -- Content-addressed runtime versions -----------

import { createHash } from "node:crypto";
import type { DB } from "./db.js";
import { ConflictError } from "@multiterm/pluto-shared";

export const SHORT_VERSION_LENGTH = 12;

export interface RuntimeVersionFile {
  readonly path: string;
  readonly sha256: string;
  readonly size: number;
}

export interface RuntimeVersion {
  readonly hash: string;
  readonly shortHash: string;
  readonly treeHash: string;
  readonly parentHash: string | null;
  readonly org: string;
  readonly repo: string;
  readonly runtime: string;
  readonly createdAt: number;
  readonly createdBy: string | null;
  readonly files: readonly RuntimeVersionFile[];
}

export interface CommitRuntimeVersionResult {
  readonly created: boolean;
  readonly version: RuntimeVersion;
}

export function commitRuntimeVersion(
  db: DB,
  input: {
    readonly org: string;
    readonly repo: string;
    readonly runtime: string;
    readonly files: readonly RuntimeVersionFile[];
    readonly createdBy: string | null;
    readonly expectedParentHash?: string | null;
  },
): CommitRuntimeVersionResult {
  const files = normalizedFiles(input.files);
  const treeHash = hash(
    files.map((file) => `${file.path}\0${file.sha256}\0${file.size}\n`).join(""),
  );

  const commit = db.transaction((): CommitRuntimeVersionResult => {
    const head = db
      .prepare(
        `SELECT v.* FROM runtime_heads h
         JOIN runtime_versions v ON v.hash = h.version_hash
         WHERE h.org = ? AND h.repo = ? AND h.runtime = ?`,
      )
      .get(input.org, input.repo, input.runtime) as VersionRow | undefined;

    const currentHash = head?.hash ?? null;
    if (input.expectedParentHash !== undefined && input.expectedParentHash !== currentHash) {
      throw new ConflictError(
        `runtime head changed: expected '${input.expectedParentHash ?? "none"}', current '${currentHash ?? "none"}'`,
      );
    }
    if (head?.tree_hash === treeHash) {
      return { created: false, version: rowToVersion(db, head) };
    }

    const parentHash = currentHash;
    const versionHash = hash(`runtime-version\0${treeHash}\0${parentHash ?? ""}`);
    const createdAt = Date.now();
    db.prepare(
      `INSERT INTO runtime_versions
       (hash, short_hash, tree_hash, parent_hash, org, repo, runtime, created_at, created_by)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      versionHash,
      versionHash.slice(0, SHORT_VERSION_LENGTH),
      treeHash,
      parentHash,
      input.org,
      input.repo,
      input.runtime,
      createdAt,
      input.createdBy,
    );
    const insertFile = db.prepare(
      `INSERT INTO runtime_version_files (version_hash, path, sha256, size)
       VALUES (?, ?, ?, ?)`,
    );
    for (const file of files) insertFile.run(versionHash, file.path, file.sha256, file.size);
    db.prepare(
      `INSERT INTO runtime_heads (org, repo, runtime, version_hash)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(org, repo, runtime) DO UPDATE SET version_hash = excluded.version_hash`,
    ).run(input.org, input.repo, input.runtime, versionHash);

    return {
      created: true,
      version: {
        hash: versionHash,
        shortHash: versionHash.slice(0, SHORT_VERSION_LENGTH),
        treeHash,
        parentHash,
        org: input.org,
        repo: input.repo,
        runtime: input.runtime,
        createdAt,
        createdBy: input.createdBy,
        files,
      },
    };
  });
  return commit();
}

export function getRuntimeHead(
  db: DB,
  org: string,
  repo: string,
  runtime: string,
): RuntimeVersion | null {
  const row = db
    .prepare(
      `SELECT v.* FROM runtime_heads h
       JOIN runtime_versions v ON v.hash = h.version_hash
       WHERE h.org = ? AND h.repo = ? AND h.runtime = ?`,
    )
    .get(org, repo, runtime) as VersionRow | undefined;
  return row ? rowToVersion(db, row) : null;
}

export function getRuntimeHeadFile(
  db: DB,
  org: string,
  repo: string,
  runtime: string,
  path: string,
): RuntimeVersionFile | null {
  const row = db
    .prepare(
      `SELECT f.path, f.sha256, f.size
       FROM runtime_heads h
       JOIN runtime_version_files f ON f.version_hash = h.version_hash
       WHERE h.org = ? AND h.repo = ? AND h.runtime = ? AND f.path = ?`,
    )
    .get(org, repo, runtime, path) as RuntimeVersionFile | undefined;
  return row ?? null;
}

export function listCommittedStoragePaths(
  db: DB,
  org: string,
  repo: string,
  runtime?: string,
): readonly string[] {
  const runtimeClause = runtime ? " AND h.runtime = ?" : "";
  const args = runtime ? [org, repo, runtime] : [org, repo];
  const rows = db
    .prepare(
      `SELECT h.org, h.repo, h.runtime, f.path
       FROM runtime_heads h
       JOIN runtime_version_files f ON f.version_hash = h.version_hash
       WHERE h.org = ? AND h.repo = ?${runtimeClause}
       ORDER BY h.runtime, f.path`,
    )
    .all(...args) as Array<{ org: string; repo: string; runtime: string; path: string }>;
  return rows.map((row) => `${row.org}/${row.repo}/${row.runtime}/${row.path}`);
}

export function hasRuntimeHead(db: DB, org: string, repo: string, runtime: string): boolean {
  return Boolean(
    db
      .prepare("SELECT 1 FROM runtime_heads WHERE org = ? AND repo = ? AND runtime = ?")
      .get(org, repo, runtime),
  );
}

export function listRuntimeVersions(
  db: DB,
  org: string,
  repo: string,
  runtime: string,
): readonly RuntimeVersion[] {
  const rows = db
    .prepare(
      `SELECT * FROM runtime_versions
       WHERE org = ? AND repo = ? AND runtime = ?
       ORDER BY created_at DESC`,
    )
    .all(org, repo, runtime) as VersionRow[];
  return rows.map((row) => rowToVersion(db, row));
}

function normalizedFiles(files: readonly RuntimeVersionFile[]): RuntimeVersionFile[] {
  const seen = new Set<string>();
  const normalized = files.map((file) => {
    const path = file.path.split("\\").join("/");
    if (
      !path ||
      path.startsWith("/") ||
      path.endsWith("/") ||
      path.includes("//") ||
      path.split("/").some((part) => !part || part === "." || part === "..") ||
      !/^[a-f0-9]{64}$/.test(file.sha256) ||
      !Number.isSafeInteger(file.size) ||
      file.size < 0
    ) {
      throw new Error("invalid runtime version manifest");
    }
    if (seen.has(path)) throw new Error(`duplicate runtime version path '${path}'`);
    seen.add(path);
    return { path, sha256: file.sha256, size: file.size };
  });
  return normalized.sort((a, b) => a.path.localeCompare(b.path));
}

function rowToVersion(db: DB, row: VersionRow): RuntimeVersion {
  const files = db
    .prepare(
      "SELECT path, sha256, size FROM runtime_version_files WHERE version_hash = ? ORDER BY path",
    )
    .all(row.hash) as RuntimeVersionFile[];
  return {
    hash: row.hash,
    shortHash: row.short_hash,
    treeHash: row.tree_hash,
    parentHash: row.parent_hash,
    org: row.org,
    repo: row.repo,
    runtime: row.runtime,
    createdAt: row.created_at,
    createdBy: row.created_by,
    files,
  };
}

function hash(value: string | Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

interface VersionRow {
  readonly hash: string;
  readonly short_hash: string;
  readonly tree_hash: string;
  readonly parent_hash: string | null;
  readonly org: string;
  readonly repo: string;
  readonly runtime: string;
  readonly created_at: number;
  readonly created_by: string | null;
}

// #endregion ------------------------------------------------
