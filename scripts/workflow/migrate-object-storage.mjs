#!/usr/bin/env bun
import { Database } from "bun:sqlite";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import postgres from "../../packages/libs/server/node_modules/postgres/src/index.js";
import { S3ObjectStore } from "../../packages/libs/server/src/object-store.ts";

const dataDir = required("DOTLOCKER_MIGRATION_DATA_DIR");
const sql = postgres(required("DOTLOCKER_DATABASE_URL"), { max: 1 });
const store = new S3ObjectStore({
  endpoint: required("DOTLOCKER_S3_ENDPOINT"),
  region: process.env.DOTLOCKER_S3_REGION ?? "garage",
  bucket: required("DOTLOCKER_S3_BUCKET"),
  accessKeyId: required("DOTLOCKER_S3_ACCESS_KEY"),
  secretAccessKey: required("DOTLOCKER_S3_SECRET_KEY"),
});
const db = new Database(join(dataDir, "pluto.db"), { readonly: true });

try {
  let paths = 0;
  let blobs = 0;
  for await (const file of files(join(dataDir, "files"))) {
    const key = relative(join(dataDir, "files"), file).split("\\").join("/");
    const body = Buffer.from(await readFile(file));
    if (key.startsWith(".pluto-objects/")) {
      await store.writeBlob(body);
      blobs++;
    } else {
      await store.write(key, body);
      await store.writeBlob(body);
      paths++;
    }
  }

  await sql.begin(async (tx) => {
    for (const row of rows("file_records"))
      await tx`
      INSERT INTO file_records (path,org,repo,runtime,rel_path,size,sha256,uploaded_by,created_at,updated_at,deleted_at)
      VALUES (${row.path},${row.org},${row.repo},${row.runtime},${row.rel_path},${row.size},${row.sha256},${row.uploaded_by},${row.created_at},${row.updated_at},${row.deleted_at})
      ON CONFLICT(path) DO UPDATE SET size=excluded.size,sha256=excluded.sha256,uploaded_by=excluded.uploaded_by,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at`;
    for (const row of rows("runtime_versions"))
      await tx`
      INSERT INTO runtime_versions (hash,short_hash,tree_hash,parent_hash,org,repo,runtime,created_at,created_by)
      VALUES (${row.hash},${row.short_hash},${row.tree_hash},${row.parent_hash},${row.org},${row.repo},${row.runtime},${row.created_at},${row.created_by}) ON CONFLICT(hash) DO NOTHING`;
    for (const row of rows("runtime_version_files"))
      await tx`
      INSERT INTO runtime_version_files (version_hash,path,sha256,size) VALUES (${row.version_hash},${row.path},${row.sha256},${row.size}) ON CONFLICT(version_hash,path) DO NOTHING`;
    for (const row of rows("runtime_heads"))
      await tx`
      INSERT INTO runtime_heads (org,repo,runtime,version_hash) VALUES (${row.org},${row.repo},${row.runtime},${row.version_hash}) ON CONFLICT(org,repo,runtime) DO UPDATE SET version_hash=excluded.version_hash`;
  });
  console.log(
    JSON.stringify({
      paths,
      blobs,
      fileRecords: rows("file_records").length,
      runtimeVersions: rows("runtime_versions").length,
    }),
  );
} finally {
  db.close();
  await sql.end();
}

function rows(table) {
  const allowed = new Set([
    "file_records",
    "runtime_versions",
    "runtime_version_files",
    "runtime_heads",
  ]);
  if (!allowed.has(table)) throw new Error("invalid migration table");
  return db.query(`SELECT * FROM ${table}`).all();
}
async function* files(root) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else if (entry.isFile() && (await stat(path)).size >= 0) yield path;
  }
}
function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required`);
  return value;
}
