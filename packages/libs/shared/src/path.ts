// #region -- Path Normalization (single chokepoint) --------

import { InvalidPathError } from "./errors.js";

const ORG_RE = /^[a-z][a-z0-9-]{1,62}$/;
const SEGMENT_RE = /^[A-Za-z0-9._-]{1,128}$/;
const MAX_SEGMENTS = 32;
const MAX_PATH_BYTES = 1024;

export interface NormalizedPath {
  readonly org: string;
  readonly segments: readonly string[];
  readonly leaf: string;
  readonly joined: string;
}

export function normalizePath(input: string): NormalizedPath {
  if (typeof input !== "string" || input.length === 0) {
    throw new InvalidPathError("path is empty", String(input));
  }
  if (Buffer.byteLength(input, "utf8") > MAX_PATH_BYTES) {
    throw new InvalidPathError(`path exceeds ${MAX_PATH_BYTES} bytes`, input);
  }
  if (input !== input.normalize("NFC")) {
    throw new InvalidPathError("path contains non-NFC unicode", input);
  }
  if (input.includes("\\") || input.includes("\0")) {
    throw new InvalidPathError("path contains illegal characters", input);
  }
  if (input.startsWith("/") || input.endsWith("/") || input.includes("//")) {
    throw new InvalidPathError("path has malformed separators", input);
  }

  const parts = input.split("/");
  if (parts.length < 2) {
    throw new InvalidPathError("path needs at least <org>/<file>", input);
  }
  if (parts.length > MAX_SEGMENTS) {
    throw new InvalidPathError(`path exceeds ${MAX_SEGMENTS} segments`, input);
  }
  for (const p of parts) {
    if (p === "." || p === ".." || !SEGMENT_RE.test(p)) {
      throw new InvalidPathError(`invalid segment '${p}'`, input);
    }
  }

  const [org] = parts;
  if (!ORG_RE.test(org)) {
    throw new InvalidPathError(`invalid org segment '${org}'`, input);
  }

  return {
    org,
    segments: parts,
    leaf: parts[parts.length - 1],
    joined: parts.join("/"),
  };
}

export function isValidOrgName(name: string): boolean {
  return typeof name === "string" && ORG_RE.test(name);
}

export function isValidSegment(name: string): boolean {
  return typeof name === "string" && SEGMENT_RE.test(name) && name !== "." && name !== "..";
}

export function joinPath(org: string, repo: string, runtime: string, relativePath: string): string {
  return normalizePath(`${org}/${repo}/${runtime}/${relativePath}`).joined;
}

// #endregion ------------------------------------------------
