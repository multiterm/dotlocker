import postgres from "postgres";
import type { DB } from "./db.js";
import {
  getFileRecord,
  listFileRecords,
  markFileDeleted,
  upsertFileRecord,
  type FileRecord,
} from "./file-records.js";
import {
  commitRuntimeVersion,
  getRuntimeHead,
  getRuntimeHeadFile,
  hasRuntimeHead,
  listCommittedStoragePaths,
  listRuntimeVersions,
  type CommitRuntimeVersionResult,
  type RuntimeVersion,
  type RuntimeVersionFile,
} from "./runtime-versions.js";
import { createHash } from "node:crypto";
import { ConflictError } from "@dotlocker/shared";

export interface MetadataStore {
  upsertFile(path: string, body: Buffer, uploadedBy: string | null): Promise<FileRecord | null>;
  markDeleted(path: string): Promise<void>;
  getFile(path: string): Promise<FileRecord | null>;
  listFiles(org: string, repo?: string, runtime?: string): Promise<readonly FileRecord[]>;
  commitVersion(input: {
    org: string;
    repo: string;
    runtime: string;
    files: readonly RuntimeVersionFile[];
    createdBy: string | null;
    expectedParentHash?: string | null;
  }): Promise<CommitRuntimeVersionResult>;
  head(org: string, repo: string, runtime: string): Promise<RuntimeVersion | null>;
  headFile(
    org: string,
    repo: string,
    runtime: string,
    path: string,
  ): Promise<RuntimeVersionFile | null>;
  hasHead(org: string, repo: string, runtime: string): Promise<boolean>;
  committedPaths(org: string, repo: string, runtime?: string): Promise<readonly string[]>;
  versions(org: string, repo: string, runtime: string): Promise<readonly RuntimeVersion[]>;
}

export class SqliteMetadataStore implements MetadataStore {
  constructor(private readonly db: DB) {}
  async upsertFile(path: string, body: Buffer, uploadedBy: string | null) {
    return upsertFileRecord(this.db, path, body, uploadedBy);
  }
  async markDeleted(path: string) {
    markFileDeleted(this.db, path);
  }
  async getFile(path: string) {
    return getFileRecord(this.db, path);
  }
  async listFiles(org: string, repo?: string, runtime?: string) {
    return listFileRecords(this.db, org, repo, runtime);
  }
  async commitVersion(input: Parameters<MetadataStore["commitVersion"]>[0]) {
    return commitRuntimeVersion(this.db, input);
  }
  async head(org: string, repo: string, runtime: string) {
    return getRuntimeHead(this.db, org, repo, runtime);
  }
  async headFile(org: string, repo: string, runtime: string, path: string) {
    return getRuntimeHeadFile(this.db, org, repo, runtime, path);
  }
  async hasHead(org: string, repo: string, runtime: string) {
    return hasRuntimeHead(this.db, org, repo, runtime);
  }
  async committedPaths(org: string, repo: string, runtime?: string) {
    return listCommittedStoragePaths(this.db, org, repo, runtime);
  }
  async versions(org: string, repo: string, runtime: string) {
    return listRuntimeVersions(this.db, org, repo, runtime);
  }
}

export class PostgresMetadataStore implements MetadataStore {
  constructor(private readonly sql: postgres.Sql) {}
  async upsertFile(
    path: string,
    body: Buffer,
    uploadedBy: string | null,
  ): Promise<FileRecord | null> {
    const parts = path.split("/");
    const [org, repo, runtime, ...rest] = parts;
    if (!org || !repo || !runtime || !rest.length) return null;
    const now = Date.now();
    const sha256 = digest(body);
    const [row] = await this
      .sql`INSERT INTO file_records (path,org,repo,runtime,rel_path,size,sha256,uploaded_by,created_at,updated_at,deleted_at)
      VALUES (${path},${org},${repo},${runtime},${rest.join("/")},${body.length},${sha256},${uploadedBy},${now},${now},NULL)
      ON CONFLICT(path) DO UPDATE SET size=excluded.size,sha256=excluded.sha256,uploaded_by=excluded.uploaded_by,updated_at=excluded.updated_at,deleted_at=NULL RETURNING *`;
    return fileRow(row);
  }
  async markDeleted(path: string) {
    const now = Date.now();
    await this.sql`UPDATE file_records SET deleted_at=${now},updated_at=${now} WHERE path=${path}`;
  }
  async getFile(path: string) {
    const [row] = await this.sql`SELECT * FROM file_records WHERE path=${path}`;
    return row ? fileRow(row) : null;
  }
  async listFiles(org: string, repo?: string, runtime?: string) {
    const rows =
      repo && runtime
        ? await this
            .sql`SELECT * FROM file_records WHERE org=${org} AND repo=${repo} AND runtime=${runtime} AND deleted_at IS NULL ORDER BY path`
        : repo
          ? await this
              .sql`SELECT * FROM file_records WHERE org=${org} AND repo=${repo} AND deleted_at IS NULL ORDER BY path`
          : await this
              .sql`SELECT * FROM file_records WHERE org=${org} AND deleted_at IS NULL ORDER BY path`;
    return rows.map(fileRow);
  }
  async commitVersion(
    input: Parameters<MetadataStore["commitVersion"]>[0],
  ): Promise<CommitRuntimeVersionResult> {
    const files = normalizeFiles(input.files);
    const treeHash = digest(files.map((f) => `${f.path}\0${f.sha256}\0${f.size}\n`).join(""));
    return this.sql.begin(async (tx) => {
      const [head] =
        await tx`SELECT v.* FROM runtime_heads h JOIN runtime_versions v ON v.hash=h.version_hash WHERE h.org=${input.org} AND h.repo=${input.repo} AND h.runtime=${input.runtime} FOR UPDATE`;
      const currentHash = head?.hash ?? null;
      if (input.expectedParentHash !== undefined && input.expectedParentHash !== currentHash)
        throw new ConflictError(
          `runtime head changed: expected '${input.expectedParentHash ?? "none"}', current '${currentHash ?? "none"}'`,
        );
      if (head?.tree_hash === treeHash)
        return { created: false, version: await pgVersion(tx, head) };
      const hash = digest(`runtime-version\0${treeHash}\0${currentHash ?? ""}`),
        createdAt = Date.now();
      await tx`INSERT INTO runtime_versions (hash,short_hash,tree_hash,parent_hash,org,repo,runtime,created_at,created_by) VALUES (${hash},${hash.slice(0, 12)},${treeHash},${currentHash},${input.org},${input.repo},${input.runtime},${createdAt},${input.createdBy})`;
      for (const file of files)
        await tx`INSERT INTO runtime_version_files (version_hash,path,sha256,size) VALUES (${hash},${file.path},${file.sha256},${file.size})`;
      await tx`INSERT INTO runtime_heads (org,repo,runtime,version_hash) VALUES (${input.org},${input.repo},${input.runtime},${hash}) ON CONFLICT(org,repo,runtime) DO UPDATE SET version_hash=excluded.version_hash`;
      return {
        created: true,
        version: {
          hash,
          shortHash: hash.slice(0, 12),
          treeHash,
          parentHash: currentHash,
          org: input.org,
          repo: input.repo,
          runtime: input.runtime,
          createdAt,
          createdBy: input.createdBy,
          files,
        },
      };
    });
  }
  async head(org: string, repo: string, runtime: string) {
    const [r] = await this
      .sql`SELECT v.* FROM runtime_heads h JOIN runtime_versions v ON v.hash=h.version_hash WHERE h.org=${org} AND h.repo=${repo} AND h.runtime=${runtime}`;
    return r ? pgVersion(this.sql, r) : null;
  }
  async headFile(org: string, repo: string, runtime: string, path: string) {
    const [r] = await this
      .sql`SELECT f.path,f.sha256,f.size FROM runtime_heads h JOIN runtime_version_files f ON f.version_hash=h.version_hash WHERE h.org=${org} AND h.repo=${repo} AND h.runtime=${runtime} AND f.path=${path}`;
    return r ? { path: r.path, sha256: r.sha256, size: Number(r.size) } : null;
  }
  async hasHead(org: string, repo: string, runtime: string) {
    const [r] = await this
      .sql`SELECT 1 FROM runtime_heads WHERE org=${org} AND repo=${repo} AND runtime=${runtime}`;
    return Boolean(r);
  }
  async committedPaths(org: string, repo: string, runtime?: string) {
    const rows = runtime
      ? await this
          .sql`SELECT h.org,h.repo,h.runtime,f.path FROM runtime_heads h JOIN runtime_version_files f ON f.version_hash=h.version_hash WHERE h.org=${org} AND h.repo=${repo} AND h.runtime=${runtime} ORDER BY h.runtime,f.path`
      : await this
          .sql`SELECT h.org,h.repo,h.runtime,f.path FROM runtime_heads h JOIN runtime_version_files f ON f.version_hash=h.version_hash WHERE h.org=${org} AND h.repo=${repo} ORDER BY h.runtime,f.path`;
    return rows.map((r) => `${r.org}/${r.repo}/${r.runtime}/${r.path}`);
  }
  async versions(org: string, repo: string, runtime: string) {
    const rows = await this
      .sql`SELECT * FROM runtime_versions WHERE org=${org} AND repo=${repo} AND runtime=${runtime} ORDER BY created_at DESC`;
    return Promise.all(rows.map((r) => pgVersion(this.sql, r)));
  }
}

function fileRow(r: any): FileRecord {
  return {
    path: r.path,
    org: r.org,
    repo: r.repo,
    runtime: r.runtime,
    relPath: r.rel_path,
    size: Number(r.size),
    sha256: r.sha256,
    uploadedBy: r.uploaded_by,
    createdAt: Number(r.created_at),
    updatedAt: Number(r.updated_at),
    deletedAt: r.deleted_at === null ? null : Number(r.deleted_at),
  };
}
async function pgVersion(
  sql: postgres.Sql | postgres.TransactionSql,
  r: any,
): Promise<RuntimeVersion> {
  const rows =
    await sql`SELECT path,sha256,size FROM runtime_version_files WHERE version_hash=${r.hash} ORDER BY path`;
  return {
    hash: r.hash,
    shortHash: r.short_hash,
    treeHash: r.tree_hash,
    parentHash: r.parent_hash,
    org: r.org,
    repo: r.repo,
    runtime: r.runtime,
    createdAt: Number(r.created_at),
    createdBy: r.created_by,
    files: rows.map((x) => ({ path: x.path, sha256: x.sha256, size: Number(x.size) })),
  };
}
function digest(v: string | Buffer) {
  return createHash("sha256").update(v).digest("hex");
}
function normalizeFiles(files: readonly RuntimeVersionFile[]) {
  const seen = new Set<string>();
  return files
    .map((f) => {
      if (
        !f.path ||
        f.path.startsWith("/") ||
        f.path.includes("..") ||
        !/^[a-f0-9]{64}$/.test(f.sha256) ||
        !Number.isSafeInteger(f.size) ||
        f.size < 0 ||
        seen.has(f.path)
      )
        throw new Error("invalid runtime version manifest");
      seen.add(f.path);
      return { ...f };
    })
    .sort((a, b) => a.path.localeCompare(b.path));
}
