import { createHash, randomBytes } from "node:crypto";
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { NotFoundError, PayloadTooLargeError } from "@dotlocker/shared";
import { FileStore } from "./files.js";

export interface ObjectStore {
  read(storagePath: string): Promise<Buffer>;
  exists(storagePath: string): Promise<boolean>;
  write(storagePath: string, body: Buffer): Promise<void>;
  writeBlob(body: Buffer): Promise<string>;
  readBlob(sha256: string): Promise<Buffer>;
  delete(storagePath: string): Promise<void>;
  list(prefix: string): Promise<readonly string[]>;
  listOrg(org: string): Promise<readonly string[]>;
}

export class FilesystemObjectStore implements ObjectStore {
  constructor(private readonly store: FileStore) {}
  async read(path: string) {
    return this.store.read(path);
  }
  async exists(path: string) {
    return this.store.exists(path);
  }
  async write(path: string, body: Buffer) {
    this.store.write(path, body);
  }
  async writeBlob(body: Buffer) {
    return this.store.writeBlob(body);
  }
  async readBlob(sha256: string) {
    return this.store.readBlob(sha256);
  }
  async delete(path: string) {
    this.store.delete(path);
  }
  async list(prefix: string) {
    return this.store.list(prefix);
  }
  async listOrg(org: string) {
    return this.store.listOrg(org);
  }
}

export interface S3ObjectStoreOptions {
  endpoint: string;
  region: string;
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 10 * 1024 * 1024;

export class S3ObjectStore implements ObjectStore {
  private readonly client: S3Client;
  private readonly maxBytes: number;
  constructor(private readonly options: S3ObjectStoreOptions) {
    this.maxBytes = options.maxBytes ?? DEFAULT_MAX_BYTES;
    this.client = new S3Client({
      endpoint: options.endpoint,
      region: options.region,
      forcePathStyle: true,
      credentials: { accessKeyId: options.accessKeyId, secretAccessKey: options.secretAccessKey },
    });
  }

  async read(storagePath: string): Promise<Buffer> {
    return this.get(`files/${safePath(storagePath)}`, storagePath);
  }
  async exists(storagePath: string): Promise<boolean> {
    try {
      await this.client.send(
        new HeadObjectCommand({
          Bucket: this.options.bucket,
          Key: `files/${safePath(storagePath)}`,
        }),
      );
      return true;
    } catch (error) {
      if (missing(error)) return false;
      throw error;
    }
  }
  async write(storagePath: string, body: Buffer): Promise<void> {
    this.checkSize(body);
    await this.put(`files/${safePath(storagePath)}`, body);
  }
  async writeBlob(body: Buffer): Promise<string> {
    this.checkSize(body);
    const sha256 = createHash("sha256").update(body).digest("hex");
    const key = `objects/${sha256.slice(0, 2)}/${sha256.slice(2)}`;
    try {
      await this.client.send(new HeadObjectCommand({ Bucket: this.options.bucket, Key: key }));
    } catch (error) {
      if (!missing(error)) throw error;
      await this.put(key, body);
    }
    return sha256;
  }
  async readBlob(sha256: string): Promise<Buffer> {
    if (!/^[a-f0-9]{64}$/.test(sha256)) throw new NotFoundError("invalid blob hash");
    return this.get(`objects/${sha256.slice(0, 2)}/${sha256.slice(2)}`, `blob '${sha256}'`);
  }
  async delete(storagePath: string): Promise<void> {
    const key = `files/${safePath(storagePath)}`;
    if (!(await this.exists(storagePath))) throw new NotFoundError(`'${storagePath}' not found`);
    await this.client.send(new DeleteObjectCommand({ Bucket: this.options.bucket, Key: key }));
  }
  async list(prefix: string): Promise<readonly string[]> {
    return this.listKeys(`files/${safePath(prefix).replace(/\/$/, "")}/`);
  }
  async listOrg(org: string): Promise<readonly string[]> {
    return this.list(org);
  }

  private async put(key: string, body: Buffer): Promise<void> {
    await this.client.send(
      new PutObjectCommand({ Bucket: this.options.bucket, Key: key, Body: body }),
    );
  }
  private async get(key: string, label: string): Promise<Buffer> {
    try {
      const response = await this.client.send(
        new GetObjectCommand({ Bucket: this.options.bucket, Key: key }),
      );
      if (!response.Body) throw new NotFoundError(`'${label}' not found`);
      return Buffer.from(await response.Body.transformToByteArray());
    } catch (error) {
      if (missing(error)) throw new NotFoundError(`'${label}' not found`);
      throw error;
    }
  }
  private async listKeys(prefix: string): Promise<readonly string[]> {
    const out: string[] = [];
    let token: string | undefined;
    do {
      const response = await this.client.send(
        new ListObjectsV2Command({
          Bucket: this.options.bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const object of response.Contents ?? [])
        if (object.Key?.startsWith("files/")) out.push(object.Key.slice(6));
      token = response.NextContinuationToken;
    } while (token);
    return out.sort();
  }
  private checkSize(body: Buffer): void {
    if (body.length > this.maxBytes)
      throw new PayloadTooLargeError(`payload exceeds ${this.maxBytes} bytes`, this.maxBytes);
  }
}

export function objectStoreFromEnvironment(fallback: FileStore): ObjectStore {
  const endpoint = process.env.DOTLOCKER_S3_ENDPOINT;
  if (!endpoint) return new FilesystemObjectStore(fallback);
  const bucket = required("DOTLOCKER_S3_BUCKET");
  return new S3ObjectStore({
    endpoint,
    bucket,
    region: process.env.DOTLOCKER_S3_REGION ?? "garage",
    accessKeyId: required("DOTLOCKER_S3_ACCESS_KEY"),
    secretAccessKey: required("DOTLOCKER_S3_SECRET_KEY"),
  });
}

function safePath(value: string): string {
  const normalized = value.replaceAll("\\", "/").replace(/^\/+/, "");
  if (!normalized || normalized.split("/").some((part) => !part || part === "." || part === ".."))
    throw new NotFoundError(`'${value}' not found`);
  return normalized;
}
function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required when DOTLOCKER_S3_ENDPOINT is configured`);
  return value;
}
function missing(error: unknown): boolean {
  const row = error as { name?: string; $metadata?: { httpStatusCode?: number } };
  return (
    row.name === "NotFound" || row.name === "NoSuchKey" || row.$metadata?.httpStatusCode === 404
  );
}
