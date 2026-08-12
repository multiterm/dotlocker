// #region -- Scope Matching --------------------------------

import { InvalidScopeError } from "./errors.js";

export type Access = "read" | "write";

export interface TokenScope {
  readonly path: string;
  readonly access: Access;
}

const SCOPE_SEGMENT_RE = /^(\*|[A-Za-z0-9._-]{1,128})$/;

export function validateScopePath(scopePath: string, org: string): void {
  if (typeof scopePath !== "string" || scopePath.length === 0) {
    throw new InvalidScopeError("scope is empty", String(scopePath));
  }
  if (scopePath.includes("\\") || scopePath.includes("\0")) {
    throw new InvalidScopeError("scope contains illegal characters", scopePath);
  }
  if (scopePath.startsWith("/") || scopePath.endsWith("/") || scopePath.includes("//")) {
    throw new InvalidScopeError("scope has malformed separators", scopePath);
  }
  if (
    scopePath.includes("{") ||
    scopePath.includes("}") ||
    scopePath.includes("[") ||
    scopePath.includes("?")
  ) {
    throw new InvalidScopeError("scope contains unsupported glob characters", scopePath);
  }

  const parts = scopePath.split("/");
  if (parts.length < 2) {
    throw new InvalidScopeError("scope needs at least <org>/<...>", scopePath);
  }
  if (parts[0] !== org) {
    throw new InvalidScopeError(`scope must start with org '${org}', got '${parts[0]}'`, scopePath);
  }
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p === "." || p === "..") {
      throw new InvalidScopeError(`invalid scope segment '${p}'`, scopePath);
    }
    if (p === "**") {
      if (i !== parts.length - 1) {
        throw new InvalidScopeError("** must be the final segment", scopePath);
      }
      continue;
    }
    if (!SCOPE_SEGMENT_RE.test(p)) {
      throw new InvalidScopeError(`invalid scope segment '${p}'`, scopePath);
    }
  }
}

export function validateScopes(scopes: readonly TokenScope[], org: string): void {
  if (!Array.isArray(scopes) || scopes.length === 0) {
    throw new InvalidScopeError("token must have at least one scope", String(scopes));
  }
  for (const s of scopes) {
    if (s.access !== "read" && s.access !== "write") {
      throw new InvalidScopeError(`access must be 'read' or 'write'`, JSON.stringify(s));
    }
    validateScopePath(s.path, org);
  }
}

export function scopeMatches(
  scopePath: string,
  scopeAccess: Access,
  requestPath: string,
  requestAccess: Access,
): boolean {
  if (scopeAccess !== requestAccess) return false;
  const scopeParts = scopePath.split("/");
  const reqParts = requestPath.split("/");
  for (let i = 0; i < scopeParts.length; i++) {
    const s = scopeParts[i];
    if (s === "**") return reqParts.length > i;
    if (i >= reqParts.length) return false;
    if (s === "*") continue;
    if (s !== reqParts[i]) return false;
  }
  return scopeParts.length === reqParts.length;
}

export function authorize(
  scopes: readonly TokenScope[],
  requestPath: string,
  requestAccess: Access,
): boolean {
  return scopes.some((s) => scopeMatches(s.path, s.access, requestPath, requestAccess));
}

// #endregion ------------------------------------------------
