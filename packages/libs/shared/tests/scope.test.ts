import { describe, it, expect } from "vitest";
import {
  validateScopePath,
  validateScopes,
  scopeMatches,
  authorize,
  type TokenScope,
} from "../src/scope.js";
import { InvalidScopeError } from "../src/errors.js";

describe("validateScopePath", () => {
  it("accepts exact path", () => {
    expect(() => validateScopePath("acme/payments/api/.env.prod", "acme")).not.toThrow();
  });

  it("accepts trailing **", () => {
    expect(() => validateScopePath("acme/payments/**", "acme")).not.toThrow();
  });

  it("accepts single-segment *", () => {
    expect(() => validateScopePath("acme/payments/*/.env.prod", "acme")).not.toThrow();
  });

  it("rejects mid-path **", () => {
    expect(() => validateScopePath("acme/**/.env.prod", "acme")).toThrow(InvalidScopeError);
  });

  it("rejects wildcard as first segment", () => {
    expect(() => validateScopePath("*/payments/.env", "acme")).toThrow(InvalidScopeError);
  });

  it("rejects scope outside requested org", () => {
    expect(() => validateScopePath("evil/**", "acme")).toThrow(/start with org/);
  });

  it("rejects brace expansion", () => {
    expect(() => validateScopePath("acme/{a,b}/.env", "acme")).toThrow(InvalidScopeError);
  });

  it("rejects bracket character classes", () => {
    expect(() => validateScopePath("acme/[abc]/.env", "acme")).toThrow(InvalidScopeError);
  });

  it("rejects extglob", () => {
    expect(() => validateScopePath("acme/?(a|b)/.env", "acme")).toThrow(InvalidScopeError);
  });
});

describe("validateScopes", () => {
  it("accepts read-only token with broad read", () => {
    const scopes: TokenScope[] = [{ path: "acme/**", access: "read" }];
    expect(() => validateScopes(scopes, "acme")).not.toThrow();
  });

  it("accepts narrow-read + write", () => {
    const scopes: TokenScope[] = [
      { path: "acme/payments/**", access: "read" },
      { path: "acme/payments/api/.env.staging", access: "write" },
    ];
    expect(() => validateScopes(scopes, "acme")).not.toThrow();
  });

  it("accepts org-admin broad-read + broad-write", () => {
    const scopes: TokenScope[] = [
      { path: "acme/**", access: "read" },
      { path: "acme/**", access: "write" },
    ];
    expect(() => validateScopes(scopes, "acme")).not.toThrow();
  });

  it("requires at least one scope", () => {
    expect(() => validateScopes([], "acme")).toThrow(InvalidScopeError);
  });

  it("rejects invalid access verb", () => {
    expect(() =>
      validateScopes(
        [{ path: "acme/**", access: "delete" as unknown as "read" }],
        "acme",
      ),
    ).toThrow(InvalidScopeError);
  });
});

describe("scopeMatches", () => {
  it("matches exact path", () => {
    expect(
      scopeMatches("acme/api/.env.prod", "read", "acme/api/.env.prod", "read"),
    ).toBe(true);
  });

  it("rejects on access mismatch", () => {
    expect(
      scopeMatches("acme/api/.env.prod", "read", "acme/api/.env.prod", "write"),
    ).toBe(false);
  });

  it("matches * to single segment", () => {
    expect(
      scopeMatches("acme/*/.env.prod", "read", "acme/api/.env.prod", "read"),
    ).toBe(true);
  });

  it("does not match * to multiple segments", () => {
    expect(
      scopeMatches("acme/*/.env.prod", "read", "acme/team/api/.env.prod", "read"),
    ).toBe(false);
  });

  it("matches ** to deep paths", () => {
    expect(
      scopeMatches("acme/payments/**", "read", "acme/payments/api/v2/.env.prod", "read"),
    ).toBe(true);
  });

  it("rejects ** crossing org boundary", () => {
    expect(
      scopeMatches("acme/**", "read", "evil/api/.env.prod", "read"),
    ).toBe(false);
  });

  it("does not match shorter path", () => {
    expect(
      scopeMatches("acme/api/.env.prod", "read", "acme/api", "read"),
    ).toBe(false);
  });
});

describe("authorize", () => {
  const scopes: TokenScope[] = [
    { path: "acme/payments/**", access: "read" },
    { path: "acme/payments/api/.env.staging", access: "write" },
  ];

  it("authorizes read within scope", () => {
    expect(authorize(scopes, "acme/payments/api/.env.prod", "read")).toBe(true);
  });

  it("authorizes the one write target", () => {
    expect(authorize(scopes, "acme/payments/api/.env.staging", "write")).toBe(true);
  });

  it("denies write outside narrow scope", () => {
    expect(authorize(scopes, "acme/payments/api/.env.prod", "write")).toBe(false);
  });

  it("denies read outside team scope", () => {
    expect(authorize(scopes, "acme/billing/api/.env.prod", "read")).toBe(false);
  });

  it("denies cross-org access entirely", () => {
    expect(authorize(scopes, "evil/payments/api/.env.prod", "read")).toBe(false);
  });
});
