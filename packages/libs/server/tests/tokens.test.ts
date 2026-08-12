import { describe, it, expect, beforeEach } from "vitest";
import { randomBytes, scryptSync } from "node:crypto";
import {
  openDb,
  createOrg,
  mintToken,
  verifyToken,
  listTokens,
  revokeToken,
  type DB,
} from "../src/index.js";
import { ID_LENGTH } from "../src/tokens.js";
import {
  ConflictError,
  InvalidPathError,
  NotFoundError,
  UnauthorizedError,
} from "@dotlocker/shared";

describe("token store", () => {
  let db: DB;

  beforeEach(() => {
    db = openDb(":memory:");
    createOrg(db, "acme");
  });

  describe("createOrg", () => {
    it("creates an org", () => {
      createOrg(db, "beta");
      const rows = db.prepare("SELECT name FROM orgs ORDER BY name").all();
      expect(rows).toEqual([{ name: "acme" }, { name: "beta" }]);
    });

    it("rejects invalid org name", () => {
      expect(() => createOrg(db, "BadOrg")).toThrow(InvalidPathError);
    });

    it("rejects duplicate org", () => {
      expect(() => createOrg(db, "acme")).toThrow(ConflictError);
    });
  });

  describe("mintToken", () => {
    it("mints a usable token", () => {
      const { plaintext, record } = mintToken(db, {
        org: "acme",
        scopes: [{ path: "acme/**", access: "read" }],
        label: "test",
      });
      expect(plaintext).toMatch(/^plt_[A-Za-z0-9_-]+_[A-Za-z0-9_-]+$/);
      expect(record.org).toBe("acme");
      expect(record.label).toBe("test");
      expect(record.scopes).toEqual([{ path: "acme/**", access: "read" }]);
      expect(record.userEmail).toBeNull();
      expect(record.service).toBeNull();
    });

    it("rejects mint into nonexistent org", () => {
      expect(() =>
        mintToken(db, {
          org: "ghost",
          scopes: [{ path: "ghost/**", access: "read" }],
        }),
      ).toThrow(NotFoundError);
    });

    it("mints an org-admin broad-read + broad-write token", () => {
      const { record } = mintToken(db, {
        org: "acme",
        scopes: [
          { path: "acme/**", access: "read" },
          { path: "acme/**", access: "write" },
        ],
      });
      expect(record.scopes).toEqual([
        { path: "acme/**", access: "read" },
        { path: "acme/**", access: "write" },
      ]);
    });
  });

  describe("verifyToken", () => {
    it("accepts the freshly-minted token", () => {
      const { plaintext, record } = mintToken(db, {
        org: "acme",
        scopes: [{ path: "acme/**", access: "read" }],
      });
      const verified = verifyToken(db, plaintext);
      expect(verified.id).toBe(record.id);
      expect(verified.scopes).toEqual(record.scopes);
    });

    it("rejects garbage", () => {
      expect(() => verifyToken(db, "garbage")).toThrow(UnauthorizedError);
      expect(() => verifyToken(db, "plt_only")).toThrow(UnauthorizedError);
      expect(() => verifyToken(db, "")).toThrow(UnauthorizedError);
    });

    it("rejects wrong secret with same id", () => {
      const { plaintext } = mintToken(db, {
        org: "acme",
        scopes: [{ path: "acme/**", access: "read" }],
      });
      const tampered = plaintext.slice(0, -4) + "XXXX";
      expect(() => verifyToken(db, tampered)).toThrow(UnauthorizedError);
    });

    it("rejects revoked token", () => {
      const { plaintext, record } = mintToken(db, {
        org: "acme",
        scopes: [{ path: "acme/**", access: "read" }],
      });
      revokeToken(db, record.id);
      expect(() => verifyToken(db, plaintext)).toThrow(UnauthorizedError);
    });

    it("rejects expired token", () => {
      const { plaintext } = mintToken(db, {
        org: "acme",
        scopes: [{ path: "acme/**", access: "read" }],
        expiresAt: Date.now() - 1000,
      });
      expect(() => verifyToken(db, plaintext)).toThrow(UnauthorizedError);
    });

    it("accepts a token whose id contains a base64url underscore (regression)", () => {
      // base64url ids contain '_' ~17% of the time. The old indexOf('_') parse
      // mis-sliced these tokens and rejected otherwise-valid credentials.
      // Hand-craft an id with an internal '_' and insert it directly so the
      // test is deterministic regardless of randomBytes output.
      const id = "ab_cdEFGH123"; // exactly ID_LENGTH (12) chars, has an internal '_'
      expect(id.length).toBe(ID_LENGTH);
      expect(id.includes("_")).toBe(true);
      const secret = randomBytes(24).toString("base64url");
      const salt = randomBytes(16).toString("base64url");
      const hash = scryptSync(secret, salt, 64).toString("base64url");
      const scopes = [{ path: "acme/**", access: "read" as const }];
      db.prepare(
        `INSERT INTO tokens (id, org, hash, salt, scopes, label, created_at, expires_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
      ).run(id, "acme", hash, salt, JSON.stringify(scopes), "underscore-id", Date.now(), null);

      const plaintext = `plt_${id}_${secret}`;
      const verified = verifyToken(db, plaintext);
      expect(verified.id).toBe(id);
      expect(verified.org).toBe("acme");
    });

    it("rejects malformed token with id shorter than ID_LENGTH", () => {
      // 11 chars before the separator (one short of ID_LENGTH) must fail
      // rather than coincidentally matching a different id.
      const shortId = "a".repeat(ID_LENGTH - 1);
      const secret = randomBytes(24).toString("base64url");
      expect(() =>
        verifyToken(db, `plt_${shortId}_${secret}`),
      ).toThrow(UnauthorizedError);
      // Missing the separator entirely must also fail.
      const id12 = "a".repeat(ID_LENGTH);
      expect(() => verifyToken(db, `plt_${id12}${secret}`)).toThrow(
        UnauthorizedError,
      );
    });

    it("accepts the happy-path 12-char id with separator at index 12", () => {
      const { plaintext } = mintToken(db, {
        org: "acme",
        scopes: [{ path: "acme/**", access: "read" }],
      });
      // plt_<12-char id>_<secret>: separator must be at offset 4 + 12 = 16
      expect(plaintext[16]).toBe("_");
      const verified = verifyToken(db, plaintext);
      expect(verified.org).toBe("acme");
    });
  });

  describe("listTokens / revokeToken", () => {
    it("lists tokens for org", () => {
      mintToken(db, {
        org: "acme",
        scopes: [{ path: "acme/**", access: "read" }],
        label: "first",
      });
      mintToken(db, {
        org: "acme",
        scopes: [{ path: "acme/**", access: "read" }],
        label: "second",
      });
      const list = listTokens(db, "acme");
      expect(list).toHaveLength(2);
      expect(new Set(list.map(t => t.label))).toEqual(new Set(["first", "second"]));
    });

    it("revoke is idempotent on the same call but fails the second time", () => {
      const { record } = mintToken(db, {
        org: "acme",
        scopes: [{ path: "acme/**", access: "read" }],
      });
      revokeToken(db, record.id);
      expect(() => revokeToken(db, record.id)).toThrow(NotFoundError);
    });
  });
});
