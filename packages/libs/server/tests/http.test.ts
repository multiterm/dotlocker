import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import {
  buildServer,
  createOrg,
  mintToken,
  openDb,
  FileStore,
  createUser,
  grantOrgAdmin,
  grantRuntime,
  type DB,
} from "../src/index.js";
import type { FastifyInstance } from "fastify";

describe("HTTP layer", () => {
  let db: DB;
  let store: FileStore;
  let app: FastifyInstance;
  let root: string;
  let acmeReadToken: string;
  let acmeWriteToken: string;

  beforeEach(async () => {
    process.env.PLUTO_ENABLE_LEGACY_AUTH = "true";
    root = mkdtempSync(join(tmpdir(), "pluto-http-"));
    db = openDb(":memory:");
    store = new FileStore({ root });
    createOrg(db, "acme");
    createOrg(db, "beta");

    acmeReadToken = mintToken(db, {
      org: "acme",
      scopes: [{ path: "acme/**", access: "read" }],
      label: "read",
    }).plaintext;

    acmeWriteToken = mintToken(db, {
      org: "acme",
      scopes: [
        { path: "acme/payments/**", access: "read" },
        { path: "acme/payments/api/.env.staging", access: "write" },
      ],
      label: "publisher",
    }).plaintext;

    app = await buildServer({
      db,
      store,
      rateLimit: { defaultsPerMinute: 10000 },
    });
  });

  afterEach(async () => {
    delete process.env.PLUTO_ENABLE_LEGACY_AUTH;
    delete process.env.PLUTO_KEYNAME_CLAIM_SINGLE_LEGACY_USER;
    delete process.env.PLUTO_BOOTSTRAP_FIRST_KEYNAME_USER;
    delete process.env.PLUTO_BOOTSTRAP_KEYNAME_DOMAINS;
    delete process.env.PLUTO_BOOTSTRAP_ORG;
    vi.unstubAllGlobals();
    await app.close();
    rmSync(root, { recursive: true, force: true });
  });

  describe("/v1/health", () => {
    it("returns 200 without auth", async () => {
      const r = await app.inject({ method: "GET", url: "/v1/health" });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toMatchObject({ ok: true });
    });

    it("returns 200 and {ok,version} with no Authorization header (Fastify 5 regression)", async () => {
      const r = await app.inject({ method: "GET", url: "/v1/health" });
      expect(r.statusCode).toBe(200);
      const body = r.json() as { ok: unknown; version: unknown };
      expect(body.ok).toBe(true);
      expect(typeof body.version).toBe("string");
    });
  });

  describe("auth", () => {
    it("establishes a Pluto session from an auth.js access token without replacing the user", async () => {
      createUser(db, {
        email: "keyname@example.com",
        password: "existing-password-is-retained",
        verified: true,
      });
      grantOrgAdmin(db, "keyname@example.com", "acme");
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                authenticated: true,
                session: {
                  id: "kn-session",
                  userEmail: "keyname@example.com",
                  principalType: "user",
                  subject: "kn_subject_123",
                  expiresAt: Date.now() + 60_000,
                  revokedAt: null,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
        ),
      );

      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/keyname/session",
        headers: { authorization: "Bearer keyname-access-token" },
      });

      expect(response.statusCode).toBe(200);
      expect(JSON.stringify(response.headers["set-cookie"])).toContain("auth_token=");
      expect(
        db.prepare("SELECT keyname_subject FROM users WHERE email = ?").get("keyname@example.com"),
      ).toMatchObject({ keyname_subject: "kn_subject_123" });
    });

    it("bootstraps the first allowed Keyname user on an empty deployment", async () => {
      db.exec("DELETE FROM tokens; DELETE FROM orgs;");
      process.env.PLUTO_BOOTSTRAP_FIRST_KEYNAME_USER = "true";
      process.env.PLUTO_BOOTSTRAP_KEYNAME_DOMAINS = "honeycluster.io";
      process.env.PLUTO_BOOTSTRAP_ORG = "honeycluster";
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                authenticated: true,
                session: {
                  id: "kn-bootstrap-session",
                  userEmail: "owner@honeycluster.io",
                  principalType: "user",
                  subject: "kn_bootstrap_subject",
                  expiresAt: Date.now() + 60_000,
                  revokedAt: null,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
        ),
      );

      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/keyname/session",
        headers: { authorization: "Bearer keyname-access-token" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({
        org: "honeycluster",
        userEmail: "owner@honeycluster.io",
      });
      expect(
        db
          .prepare("SELECT role FROM org_memberships WHERE email = ? AND org = ?")
          .get("owner@honeycluster.io", "honeycluster"),
      ).toMatchObject({ role: "org_admin" });
    });

    it("upgrades a legacy Keyname email link to the immutable subject", async () => {
      createUser(db, {
        email: "admin@legacy.invalid",
        password: "existing-password-is-retained",
        verified: true,
      });
      grantOrgAdmin(db, "admin@legacy.invalid", "acme");
      db.prepare("UPDATE users SET keyname_subject = ? WHERE email = ?").run(
        "owner@honeycluster.io",
        "admin@legacy.invalid",
      );
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                authenticated: true,
                session: {
                  id: "kn-legacy-email-session",
                  userEmail: "owner@honeycluster.io",
                  principalType: "user",
                  subject: "kn_immutable_subject",
                  expiresAt: Date.now() + 60_000,
                  revokedAt: null,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
        ),
      );

      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/keyname/session",
        headers: { authorization: "Bearer keyname-access-token" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ userEmail: "admin@legacy.invalid" });
      expect(
        db.prepare("SELECT keyname_subject FROM users WHERE email = ?").get("admin@legacy.invalid"),
      ).toMatchObject({ keyname_subject: "kn_immutable_subject" });
    });

    it("can claim the sole legacy account once during the Keyname migration", async () => {
      process.env.PLUTO_KEYNAME_CLAIM_SINGLE_LEGACY_USER = "true";
      createUser(db, {
        email: "admin@legacy.invalid",
        password: "existing-password-is-retained",
        verified: true,
      });
      grantOrgAdmin(db, "admin@legacy.invalid", "acme");
      vi.stubGlobal(
        "fetch",
        vi.fn(
          async () =>
            new Response(
              JSON.stringify({
                authenticated: true,
                session: {
                  id: "kn-migration-session",
                  userEmail: "operator@example.com",
                  principalType: "user",
                  subject: "kn_migrated_subject",
                  expiresAt: Date.now() + 60_000,
                  revokedAt: null,
                },
              }),
              { status: 200, headers: { "content-type": "application/json" } },
            ),
        ),
      );

      const response = await app.inject({
        method: "POST",
        url: "/v1/auth/keyname/session",
        headers: { authorization: "Bearer keyname-access-token" },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ org: "acme", userEmail: "admin@legacy.invalid" });
      expect(
        db.prepare("SELECT keyname_subject FROM users WHERE email = ?").get("admin@legacy.invalid"),
      ).toMatchObject({ keyname_subject: "kn_migrated_subject" });
    });

    it("401 without bearer", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/v1/files/acme/api/.env.prod",
      });
      expect(r.statusCode).toBe(401);
    });

    it("401 with garbage bearer", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/v1/files/acme/api/.env.prod",
        headers: { authorization: "Bearer garbage" },
      });
      expect(r.statusCode).toBe(401);
    });
  });

  describe("tenant isolation", () => {
    it("forbids reading another org with valid token", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/v1/files/beta/api/.env.prod",
        headers: { authorization: `Bearer ${acmeReadToken}` },
      });
      expect(r.statusCode).toBe(403);
    });
  });

  describe("GET /v1/files", () => {
    it("returns ciphertext when scope authorizes", async () => {
      store.write("acme/api/.env.prod", Buffer.from("CIPHER"));
      const r = await app.inject({
        method: "GET",
        url: "/v1/files/acme/api/.env.prod",
        headers: { authorization: `Bearer ${acmeReadToken}` },
      });
      expect(r.statusCode).toBe(200);
      expect(r.body).toBe("CIPHER");
    });

    it("404 when file missing", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/v1/files/acme/api/.env.prod",
        headers: { authorization: `Bearer ${acmeReadToken}` },
      });
      expect(r.statusCode).toBe(404);
    });

    it("400 on traversal", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/v1/files/acme/..%2Fetc/.env.prod",
        headers: { authorization: `Bearer ${acmeReadToken}` },
      });
      expect([400, 404]).toContain(r.statusCode);
    });
  });

  describe("PUT /v1/files", () => {
    it("writes within write scope", async () => {
      const r = await app.inject({
        method: "PUT",
        url: "/v1/files/acme/payments/api/.env.staging",
        headers: {
          authorization: `Bearer ${acmeWriteToken}`,
          "content-type": "application/octet-stream",
        },
        payload: Buffer.from("encrypted"),
      });
      expect(r.statusCode).toBe(204);
      expect(store.read("acme/payments/api/.env.staging").toString()).toBe("encrypted");
    });

    it("publishes and revokes an opt-in public asset", async () => {
      const path = "acme/payments/api/.env.staging";
      await app.inject({
        method: "PUT",
        url: `/v1/files/${path}`,
        headers: {
          authorization: `Bearer ${acmeWriteToken}`,
          "content-type": "application/octet-stream",
        },
        payload: Buffer.from("public-body"),
      });
      const published = await app.inject({
        method: "POST",
        url: "/v1/public-files",
        headers: { authorization: `Bearer ${acmeWriteToken}` },
        payload: { path },
      });
      expect(published.statusCode).toBe(201);
      const url = (published.json() as { url: string }).url;
      const publicRead = await app.inject({ method: "GET", url });
      expect(publicRead.statusCode).toBe(200);
      expect(publicRead.body).toBe("public-body");
      expect(publicRead.headers["cache-control"]).toContain("public");
      expect(
        (
          await app.inject({
            method: "DELETE",
            url: "/v1/public-files",
            headers: { authorization: `Bearer ${acmeWriteToken}` },
            payload: { path },
          })
        ).statusCode,
      ).toBe(204);
      expect((await app.inject({ method: "GET", url })).statusCode).toBe(404);
    });

    it("403 outside narrow write scope", async () => {
      const r = await app.inject({
        method: "PUT",
        url: "/v1/files/acme/payments/api/.env.prod",
        headers: {
          authorization: `Bearer ${acmeWriteToken}`,
          "content-type": "application/octet-stream",
        },
        payload: Buffer.from("encrypted"),
      });
      expect(r.statusCode).toBe(403);
    });

    it("403 when read-only token tries to write", async () => {
      const r = await app.inject({
        method: "PUT",
        url: "/v1/files/acme/api/.env.prod",
        headers: {
          authorization: `Bearer ${acmeReadToken}`,
          "content-type": "application/octet-stream",
        },
        payload: Buffer.from("x"),
      });
      expect(r.statusCode).toBe(403);
    });
  });

  describe("auth API + grants", () => {
    it("logs in a user and gates sync to runtime grants", async () => {
      createUser(db, {
        email: "agent@example.com",
        password: "correct-horse-battery-staple",
        verified: true,
      });
      grantRuntime(db, {
        email: "agent@example.com",
        org: "acme",
        repo: "portal",
        runtime: "preview",
        access: "read",
      });
      store.write("acme/portal/dev/.env", Buffer.from("dev"));
      store.write("acme/portal/preview/.env", Buffer.from("preview"));

      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "agent@example.com",
          password: "correct-horse-battery-staple",
          org: "acme",
        },
      });
      expect(login.statusCode).toBe(200);
      const token = (login.json() as { token: string }).token;

      const manifest = await app.inject({
        method: "GET",
        url: "/v1/resolve/acme/portal",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(manifest.json()).toEqual({ files: ["acme/portal/preview/.env"] });
    });

    it("lets a granted user mint and revoke a scoped token via API", async () => {
      createUser(db, {
        email: "token-user@example.com",
        password: "correct-horse-battery-staple",
        verified: true,
      });
      grantRuntime(db, {
        email: "token-user@example.com",
        org: "acme",
        repo: "portal",
        runtime: "preview",
        access: "read",
      });
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "token-user@example.com",
          password: "correct-horse-battery-staple",
          org: "acme",
        },
      });
      const session = (login.json() as { token: string }).token;
      const minted = await app.inject({
        method: "POST",
        url: "/v1/tokens",
        headers: { authorization: `Bearer ${session}` },
        payload: { scopes: [{ path: "acme/portal/preview/**", access: "read" }], label: "agent" },
      });
      expect(minted.statusCode).toBe(200);
      const id = (minted.json() as { record: { id: string } }).record.id;
      const listed = await app.inject({
        method: "GET",
        url: "/v1/tokens",
        headers: { authorization: `Bearer ${session}` },
      });
      expect((listed.json() as { tokens: Array<{ id: string; label: string }> }).tokens).toEqual([
        expect.objectContaining({ id, label: "agent" }),
      ]);
      const revoked = await app.inject({
        method: "DELETE",
        url: `/v1/tokens/${id}`,
        headers: { authorization: `Bearer ${session}` },
      });
      expect(revoked.statusCode).toBe(204);
    });

    it("lets an authenticated user create and switch to an organization", async () => {
      createUser(db, {
        email: "org-owner@example.com",
        password: "correct-horse-battery-staple",
        verified: true,
      });
      grantRuntime(db, {
        email: "org-owner@example.com",
        org: "acme",
        repo: "portal",
        runtime: "preview",
        access: "read",
      });
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "org-owner@example.com",
          password: "correct-horse-battery-staple",
          org: "acme",
        },
      });
      const session = (login.json() as { token: string }).token;
      const created = await app.inject({
        method: "POST",
        url: "/v1/orgs",
        headers: { authorization: `Bearer ${session}` },
        payload: { name: "new-team" },
      });
      expect(created.statusCode).toBe(201);
      expect(created.json()).toEqual({ org: "new-team" });
      const switched = await app.inject({
        method: "POST",
        url: "/v1/auth/switch-org",
        headers: { authorization: `Bearer ${session}` },
        payload: { org: "new-team" },
      });
      expect(switched.statusCode).toBe(200);
      expect(switched.json()).toMatchObject({
        token: { id: (login.json() as { tokenId: string }).tokenId, org: "new-team" },
        orgs: ["acme", "new-team"],
      });
      const me = await app.inject({
        method: "GET",
        url: "/v1/me",
        headers: { authorization: `Bearer ${session}` },
      });
      expect(me.statusCode).toBe(200);
      expect(me.json()).toMatchObject({ token: { org: "new-team" } });
    });

    it("supports Tailscale trusted-header login when enabled", async () => {
      process.env.PLUTO_TRUST_TAILSCALE_HEADERS = "true";
      createUser(db, {
        email: "ts@example.com",
        password: "correct-horse-battery-staple",
        verified: true,
      });
      grantRuntime(db, {
        email: "ts@example.com",
        org: "acme",
        repo: "portal",
        runtime: "preview",
        access: "read",
      });
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/tailscale",
        headers: { "tailscale-user-login": "ts@example.com" },
        payload: { org: "acme" },
      });
      delete process.env.PLUTO_TRUST_TAILSCALE_HEADERS;
      expect(login.statusCode).toBe(200);
      expect(login.json()).toHaveProperty("token");
    });

    it("retires native TOTP because MFA is managed by Keyname", async () => {
      createUser(db, {
        email: "mfa@example.com",
        password: "correct-horse-battery-staple",
        verified: true,
      });
      grantOrgAdmin(db, "mfa@example.com", "acme");
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "mfa@example.com",
          password: "correct-horse-battery-staple",
          org: "acme",
        },
      });
      const token = (login.json() as { token: string }).token;
      const setup = await app.inject({
        method: "POST",
        url: "/v1/mfa/totp/setup",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(setup.statusCode).toBe(410);
      expect(setup.json()).toMatchObject({ error: "PLUTO_KEYNAME_AUTH_REQUIRED" });
    });

    it("records file metadata and exposes audit to org admins", async () => {
      createUser(db, {
        email: "audit-admin@example.com",
        password: "correct-horse-battery-staple",
        verified: true,
      });
      grantOrgAdmin(db, "audit-admin@example.com", "acme");
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "audit-admin@example.com",
          password: "correct-horse-battery-staple",
          org: "acme",
        },
      });
      const token = (login.json() as { token: string }).token;
      const put = await app.inject({
        method: "PUT",
        url: "/v1/files/acme/portal/preview/test.txt",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
        payload: Buffer.from("hello"),
      });
      expect(put.statusCode).toBe(204);
      const meta = await app.inject({
        method: "GET",
        url: "/v1/files-meta/acme/portal/preview",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(meta.json()).toMatchObject({
        files: [
          { path: "acme/portal/preview/test.txt", size: 5, uploadedBy: "audit-admin@example.com" },
        ],
      });
      const audit = await app.inject({
        method: "GET",
        url: "/v1/audit/acme",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(audit.statusCode).toBe(200);
      expect(
        (audit.json() as { audit: Array<{ action: string }> }).audit.some(
          (a) => a.action === "put",
        ),
      ).toBe(true);
      const del = await app.inject({
        method: "DELETE",
        url: "/v1/files/acme/portal/preview/test.txt",
        headers: { authorization: `Bearer ${token}` },
      });
      expect(del.statusCode).toBe(204);
      expect(() => store.read("acme/portal/preview/test.txt")).toThrow();
    });

    it("lets org admins configure signed webhooks and records deliveries", async () => {
      createUser(db, {
        email: "hooks-admin@example.com",
        password: "correct-horse-battery-staple",
        verified: true,
      });
      grantOrgAdmin(db, "hooks-admin@example.com", "acme");
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "hooks-admin@example.com",
          password: "correct-horse-battery-staple",
          org: "acme",
        },
      });
      const token = (login.json() as { token: string }).token;
      const fetchMock = vi.fn(async () => new Response("ok", { status: 200 }));
      vi.stubGlobal("fetch", fetchMock);
      const created = await app.inject({
        method: "POST",
        url: "/v1/webhooks",
        headers: { authorization: `Bearer ${token}` },
        payload: {
          name: "runtime events",
          url: "http://localhost:9876/pluto",
          events: ["put", "version"],
        },
      });
      expect(created.statusCode).toBe(201);
      const result = created.json() as { webhook: { id: string }; secret: string };
      expect(result.secret).toMatch(/^plwhsec_/);

      const put = await app.inject({
        method: "PUT",
        url: "/v1/files/acme/portal/preview/hook.txt",
        headers: { authorization: `Bearer ${token}`, "content-type": "application/octet-stream" },
        payload: Buffer.from("hook"),
      });
      expect(put.statusCode).toBe(204);
      await vi.waitFor(() => expect(fetchMock).toHaveBeenCalled());
      const request = fetchMock.mock.calls[0];
      expect((request?.[1] as RequestInit).headers).toMatchObject({
        "x-pluto-event": "pluto.put",
      });
      const deliveries = await app.inject({
        method: "GET",
        url: `/v1/webhooks/${result.webhook.id}/deliveries`,
        headers: { authorization: `Bearer ${token}` },
      });
      expect(deliveries.statusCode).toBe(200);
      expect(deliveries.json()).toMatchObject({
        deliveries: [{ event: "put", status: "delivered", responseStatus: 200 }],
      });
    });

    it("org admin can grant repo access via API", async () => {
      createUser(db, {
        email: "admin@example.com",
        password: "correct-horse-battery-staple",
        verified: true,
      });
      createUser(db, {
        email: "dev@example.com",
        password: "correct-horse-battery-staple",
        verified: true,
      });
      grantOrgAdmin(db, "admin@example.com", "acme");
      const login = await app.inject({
        method: "POST",
        url: "/v1/auth/login",
        payload: {
          email: "admin@example.com",
          password: "correct-horse-battery-staple",
          org: "acme",
        },
      });
      const token = (login.json() as { token: string }).token;
      const grant = await app.inject({
        method: "POST",
        url: "/v1/grants/repo",
        headers: { authorization: `Bearer ${token}` },
        payload: { email: "dev@example.com", org: "acme", repo: "portal", access: "read" },
      });
      expect(grant.statusCode).toBe(200);
      expect(grant.json()).toMatchObject({
        grant: { email: "dev@example.com", org: "acme", repo: "portal", access: "read" },
      });
      const grants = await app.inject({
        method: "GET",
        url: "/v1/grants/acme",
        headers: { authorization: `Bearer ${token}` },
      });
      expect((grants.json() as { grants: unknown[] }).grants.length).toBeGreaterThan(0);
      const revoked = await app.inject({
        method: "DELETE",
        url: "/v1/grants",
        headers: { authorization: `Bearer ${token}` },
        payload: { email: "dev@example.com", org: "acme", repo: "portal" },
      });
      expect(revoked.statusCode).toBe(204);
    });
  });

  describe("runtime versions", () => {
    it("keeps the current version for identical trees and appends changed trees", async () => {
      const token = mintToken(db, {
        org: "acme",
        scopes: [
          { path: "acme/portal/**", access: "read" },
          { path: "acme/portal/**", access: "write" },
        ],
      }).plaintext;
      const auth = { authorization: `Bearer ${token}` };
      const firstBody = Buffer.from("first");
      const firstSha = createHash("sha256").update(firstBody).digest("hex");
      const staged = await app.inject({
        method: "PUT",
        url: `/v1/runtimes/acme/portal/preview/objects/${firstSha}`,
        headers: { ...auth, "content-type": "application/octet-stream" },
        payload: firstBody,
      });
      expect(staged.statusCode).toBe(204);
      const beforeCommit = await app.inject({
        method: "GET",
        url: "/v1/files/acme/portal/preview/config.txt",
        headers: auth,
      });
      expect(beforeCommit.statusCode).toBe(404);

      const first = await app.inject({
        method: "POST",
        url: "/v1/runtimes/acme/portal/preview/versions",
        headers: auth,
        payload: {
          expectedParentHash: null,
          files: [{ path: "config.txt", sha256: firstSha, size: firstBody.length }],
        },
      });
      expect(first.statusCode).toBe(201);
      const firstVersion = (first.json() as { version: { hash: string; shortHash: string } })
        .version;
      expect(firstVersion.hash).toHaveLength(64);
      expect(firstVersion.shortHash).toBe(firstVersion.hash.slice(0, 12));

      const unchanged = await app.inject({
        method: "POST",
        url: "/v1/runtimes/acme/portal/preview/versions",
        headers: auth,
        payload: {
          expectedParentHash: firstVersion.hash,
          files: [{ path: "config.txt", sha256: firstSha, size: firstBody.length }],
        },
      });
      expect(unchanged.statusCode).toBe(200);
      expect(unchanged.json()).toMatchObject({
        created: false,
        version: { hash: firstVersion.hash },
      });

      const secondBody = Buffer.from("second");
      const secondSha = createHash("sha256").update(secondBody).digest("hex");
      await app.inject({
        method: "PUT",
        url: `/v1/runtimes/acme/portal/preview/objects/${secondSha}`,
        headers: { ...auth, "content-type": "application/octet-stream" },
        payload: secondBody,
      });
      const whileStaged = await app.inject({
        method: "GET",
        url: "/v1/files/acme/portal/preview/config.txt",
        headers: auth,
      });
      expect(whileStaged.body).toBe("first");
      const second = await app.inject({
        method: "POST",
        url: "/v1/runtimes/acme/portal/preview/versions",
        headers: auth,
        payload: {
          expectedParentHash: firstVersion.hash,
          files: [{ path: "config.txt", sha256: secondSha, size: secondBody.length }],
        },
      });
      expect(second.statusCode).toBe(201);
      expect(second.json()).toMatchObject({
        created: true,
        version: { parentHash: firstVersion.hash },
      });

      const conflict = await app.inject({
        method: "POST",
        url: "/v1/runtimes/acme/portal/preview/versions",
        headers: auth,
        payload: {
          expectedParentHash: firstVersion.hash,
          files: [{ path: "config.txt", sha256: firstSha, size: firstBody.length }],
        },
      });
      expect(conflict.statusCode).toBe(409);
      expect(conflict.json()).toMatchObject({
        error: "PLUTO_CONFLICT",
        expectedParentHash: firstVersion.hash,
      });

      const history = await app.inject({
        method: "GET",
        url: "/v1/runtimes/acme/portal/preview/versions",
        headers: auth,
      });
      expect(history.statusCode).toBe(200);
      expect((history.json() as { versions: unknown[] }).versions).toHaveLength(2);
    });
  });

  describe("GET /v1/resolve", () => {
    beforeEach(() => {
      store.write("acme/.env", Buffer.from("a"));
      store.write("acme/payments/.env", Buffer.from("b"));
      store.write("acme/payments/api/.env", Buffer.from("c"));
      store.write("acme/payments/api/.env.prod", Buffer.from("d"));
    });

    it("returns files under a repo/runtime prefix", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/v1/resolve/acme/payments/api",
        headers: { authorization: `Bearer ${acmeReadToken}` },
      });
      expect(r.statusCode).toBe(200);
      expect(r.json()).toEqual({
        files: ["acme/payments/api/.env", "acme/payments/api/.env.prod"],
      });
    });

    it("filters by token's read scope", async () => {
      const narrowToken = mintToken(db, {
        org: "acme",
        scopes: [{ path: "acme/payments/api/.env.prod", access: "read" }],
      }).plaintext;
      const r = await app.inject({
        method: "GET",
        url: "/v1/resolve/acme/payments/api",
        headers: { authorization: `Bearer ${narrowToken}` },
      });
      expect(r.json()).toEqual({
        files: ["acme/payments/api/.env.prod"],
      });
    });

    it("sync manifest is scope-gated by repo/runtime", async () => {
      store.write("acme/portal/dev/.env", Buffer.from("dev"));
      store.write("acme/portal/preview/.env", Buffer.from("preview"));
      store.write("acme/portal/prod/.env", Buffer.from("prod"));
      store.write("acme/drones/prod/.env", Buffer.from("drones"));

      const previewToken = mintToken(db, {
        org: "acme",
        scopes: [{ path: "acme/portal/preview/**", access: "read" }],
      }).plaintext;
      const preview = await app.inject({
        method: "GET",
        url: "/v1/resolve/acme/portal",
        headers: { authorization: `Bearer ${previewToken}` },
      });
      expect(preview.json()).toEqual({ files: ["acme/portal/preview/.env"] });

      const admin = await app.inject({
        method: "GET",
        url: "/v1/resolve/acme/portal",
        headers: { authorization: `Bearer ${acmeReadToken}` },
      });
      expect(admin.json()).toEqual({
        files: ["acme/portal/dev/.env", "acme/portal/preview/.env", "acme/portal/prod/.env"],
      });
    });

    it("403 across orgs", async () => {
      const r = await app.inject({
        method: "GET",
        url: "/v1/resolve/beta/payments/api",
        headers: { authorization: `Bearer ${acmeReadToken}` },
      });
      expect(r.statusCode).toBe(403);
    });
  });
});
