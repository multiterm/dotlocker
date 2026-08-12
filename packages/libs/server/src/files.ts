// #region -- File store ------------------------------------

import {
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
  readdirSync,
  existsSync,
  unlinkSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import { normalizePath } from "@dotlocker/shared";
import { NotFoundError, PayloadTooLargeError } from "@dotlocker/shared";

export interface FileStoreOptions {
  readonly root: string;
  readonly maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export class FileStore {
  readonly #root: string;
  readonly #maxBytes: number;

  constructor(opts: FileStoreOptions) {
    this.#root = opts.root;
    this.#maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
    mkdirSync(this.#root, { recursive: true });
  }

  read(storagePath: string): Buffer {
    const n = normalizePath(storagePath);
    const abs = join(this.#root, n.joined);
    try {
      const s = statSync(abs);
      if (!s.isFile()) throw new NotFoundError(`'${n.joined}' not found`);
      return readFileSync(abs);
    } catch (err: unknown) {
      if (isENOENT(err)) throw new NotFoundError(`'${n.joined}' not found`);
      throw err;
    }
  }

  exists(storagePath: string): boolean {
    const n = normalizePath(storagePath);
    try {
      return statSync(join(this.#root, n.joined)).isFile();
    } catch {
      return false;
    }
  }

  write(storagePath: string, body: Buffer): void {
    if (body.length > this.#maxBytes) {
      throw new PayloadTooLargeError(`payload exceeds ${this.#maxBytes} bytes`, this.#maxBytes);
    }
    const n = normalizePath(storagePath);
    this.#atomicWrite(join(this.#root, n.joined), body);
  }

  writeBlob(body: Buffer): string {
    const sha256 = createHash("sha256").update(body).digest("hex");
    const abs = join(this.#root, ".pluto-objects", sha256.slice(0, 2), sha256.slice(2));
    if (!existsSync(abs)) this.#atomicWrite(abs, body);
    return sha256;
  }

  readBlob(sha256: string): Buffer {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new NotFoundError("invalid blob hash");
    try {
      return readFileSync(join(this.#root, ".pluto-objects", sha256.slice(0, 2), sha256.slice(2)));
    } catch (err: unknown) {
      if (isENOENT(err)) throw new NotFoundError(`blob '${sha256}' not found`);
      throw err;
    }
  }

  #atomicWrite(abs: string, body: Buffer): void {
    mkdirSync(dirname(abs), { recursive: true });
    const tmp = `${abs}.${randomBytes(6).toString("hex")}.tmp`;
    writeFileSync(tmp, body, { mode: 0o600 });
    renameSync(tmp, abs);
  }

  delete(storagePath: string): void {
    const n = normalizePath(storagePath);
    try {
      unlinkSync(join(this.#root, n.joined));
    } catch (err: unknown) {
      if (isENOENT(err)) throw new NotFoundError(`'${n.joined}' not found`);
      throw err;
    }
  }

  list(prefix: string): readonly string[] {
    const n = normalizePath(`${prefix}/_`);
    const prefixParts = n.segments.slice(0, -1);
    const base = join(this.#root, ...prefixParts);
    if (!existsSync(base)) return [];
    const out: string[] = [];
    walk(base, base, out);
    return out.map((p) => [...prefixParts, p].join("/")).sort();
  }

  listOrg(org: string): readonly string[] {
    const out: string[] = [];
    const base = join(this.#root, org);
    if (!existsSync(base)) return out;
    walk(base, base, out);
    return out.map((p) => `${org}/${p}`).sort();
  }
}

function isENOENT(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: string }).code === "ENOENT";
}

function walk(root: string, dir: string, out: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const abs = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(root, abs, out);
    } else if (entry.isFile()) {
      out.push(
        abs
          .slice(root.length + 1)
          .split("/")
          .join("/"),
      );
    }
  }
}

// #endregion ------------------------------------------------
