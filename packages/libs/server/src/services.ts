// #region -- Service registry ------------------------------

import { isIP } from "node:net";
import type { DB } from "./db.js";
import { InvalidPathError, NotFoundError } from "@dotlocker/shared";
import { isValidOrgName, isValidSegment } from "@dotlocker/shared";

export interface ServiceRecord {
  readonly org: string;
  readonly name: string;
  readonly ownerEmail: string | null;
  readonly allowedSources: readonly string[];
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface UpsertServiceInput {
  readonly org: string;
  readonly name: string;
  readonly ownerEmail?: string | null;
  readonly allowedSources?: readonly string[];
}

export function isValidServiceName(name: string): boolean {
  if (name === "") return true;
  return name.split("/").every(isValidSegment);
}

export function upsertService(db: DB, input: UpsertServiceInput): ServiceRecord {
  if (!isValidOrgName(input.org)) throw new InvalidPathError("invalid org name", input.org);
  if (!isValidServiceName(input.name))
    throw new InvalidPathError("invalid service name", input.name);
  const allowedSources = [...(input.allowedSources ?? [])];
  const now = Date.now();
  db.prepare(
    `INSERT INTO services (org, name, owner_email, allowed_sources, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(org, name) DO UPDATE SET
       owner_email = excluded.owner_email,
       allowed_sources = excluded.allowed_sources,
       updated_at = excluded.updated_at`,
  ).run(input.org, input.name, input.ownerEmail ?? null, JSON.stringify(allowedSources), now, now);
  return getService(db, input.org, input.name);
}

export function getService(db: DB, org: string, name: string): ServiceRecord {
  const row = db
    .prepare(
      `SELECT org, name, owner_email, allowed_sources, created_at, updated_at
     FROM services WHERE org = ? AND name = ?`,
    )
    .get(org, name) as
    | {
        org: string;
        name: string;
        owner_email: string | null;
        allowed_sources: string;
        created_at: number;
        updated_at: number;
      }
    | undefined;
  if (!row) throw new NotFoundError(`service '${org}/${name}' not found`);
  return rowToService(row);
}

export function maybeGetService(db: DB, org: string, name: string): ServiceRecord | null {
  try {
    return getService(db, org, name);
  } catch (err) {
    if (err instanceof NotFoundError) return null;
    throw err;
  }
}

export function listServices(db: DB, org: string): readonly ServiceRecord[] {
  const rows = db
    .prepare(
      `SELECT org, name, owner_email, allowed_sources, created_at, updated_at
     FROM services WHERE org = ? ORDER BY name`,
    )
    .all(org) as readonly {
    org: string;
    name: string;
    owner_email: string | null;
    allowed_sources: string;
    created_at: number;
    updated_at: number;
  }[];
  return rows.map(rowToService);
}

export function serviceWarningForRequest(
  service: ServiceRecord | null,
  requestIp: string | null,
  requestRegion: string | null,
): string | null {
  if (!service || service.allowedSources.length === 0) return null;
  const sources = service.allowedSources.map((s) => s.toLowerCase());
  const ip = requestIp?.toLowerCase() ?? "";
  const region = requestRegion?.toLowerCase() ?? "";
  const ipOk = ip !== "" && sources.some((source) => sourceMatchesIp(source, ip));
  const regionOk =
    region !== "" && sources.some((source) => source === `region:${region}` || source === region);
  if (ipOk || regionOk) return null;
  return `request source not registered for ${service.org}/${service.name}: ip=${requestIp ?? "unknown"} region=${requestRegion ?? "unknown"}`;
}

function rowToService(row: {
  org: string;
  name: string;
  owner_email: string | null;
  allowed_sources: string;
  created_at: number;
  updated_at: number;
}): ServiceRecord {
  let allowedSources: string[] = [];
  try {
    const parsed = JSON.parse(row.allowed_sources) as unknown;
    if (Array.isArray(parsed)) allowedSources = parsed.filter((v) => typeof v === "string");
  } catch {
    allowedSources = [];
  }
  return {
    org: row.org,
    name: row.name,
    ownerEmail: row.owner_email,
    allowedSources,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function sourceMatchesIp(source: string, ip: string): boolean {
  if (source === ip) return true;
  if (!source.includes("/")) return false;
  const [base, bitsRaw] = source.split("/");
  const bits = Number(bitsRaw);
  if (isIP(base) !== 4 || isIP(ip) !== 4 || !Number.isInteger(bits) || bits < 0 || bits > 32) {
    return false;
  }
  const mask = bits === 0 ? 0 : 0xffffffff << (32 - bits);
  return (ipv4ToInt(base) & mask) === (ipv4ToInt(ip) & mask);
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => ((acc << 8) + Number(part)) >>> 0, 0);
}

// #endregion ------------------------------------------------
