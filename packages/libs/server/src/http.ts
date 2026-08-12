// #region -- HTTP layer (Fastify) --------------------------

import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import rateLimit from "@fastify/rate-limit";
import { normalizePath, isValidOrgName, isValidSegment } from "@dotlocker/shared";
import { authorize, type Access } from "@dotlocker/shared";
import { ForbiddenError, NotFoundError, PlutoError, UnauthorizedError } from "@dotlocker/shared";
import { type TokenRecord } from "./tokens.js";
import type { DB } from "./db.js";
import { FileStore } from "./files.js";
import { FilesystemObjectStore, type ObjectStore } from "./object-store.js";
import { recentAudit, recordAudit, type AuditAction } from "./audit.js";
import { maybeGetService, serviceWarningForRequest } from "./services.js";
import { verifyUserEmail } from "./users.js";
import { type GrantAccess } from "./grants.js";
import type { RuntimeVersionFile } from "./runtime-versions.js";
import {
  PostgresMetadataStore,
  SqliteMetadataStore,
  type MetadataStore,
} from "./metadata-store.js";
import { postgresAuthStore, sqliteAuthStore, type AuthStore } from "./auth-store.js";
import postgres from "postgres";
import { migratePostgres } from "./db/postgres-migrate.js";
import { webUiAssetPath, webUiHtml } from "./webui.js";
import { verifyKeynameSession } from "./keyname.js";
import {
  createWebhook,
  deleteWebhook,
  listWebhookDeliveries,
  listWebhooks,
  updateWebhook,
} from "./webhooks.js";

const MAX_BODY_BYTES = 256 * 1024;

export interface BuildServerOptions {
  readonly db: DB;
  readonly store: ObjectStore | FileStore;
  readonly metadataStore?: MetadataStore;
  readonly version?: string;
  readonly rateLimit?: {
    readonly defaultsPerMinute?: number;
    readonly perOrg?: Record<string, number>;
  };
  readonly logger?: boolean;
  readonly authStore?: AuthStore;
}

// Augment FastifyRequest so handlers can read the auth context the hook set.
declare module "fastify" {
  interface FastifyRequest {
    token?: TokenRecord;
  }
}

export async function buildServer(opts: BuildServerOptions): Promise<FastifyInstance> {
  const { db, version = "dev" } = opts;
  const store =
    opts.store instanceof FileStore ? new FilesystemObjectStore(opts.store) : opts.store;
  const pgUrl =
    process.env.DOTLOCKER_DATABASE_URL ??
    process.env.PLUTO_DATABASE_URL ??
    process.env.DATABASE_URL;
  const pgClient = opts.authStore ? null : pgUrl ? postgres(pgUrl, { max: 10 }) : null;
  if (pgClient) await migratePostgres(pgClient);
  const auth = opts.authStore ?? (pgClient ? postgresAuthStore(pgClient) : sqliteAuthStore(db));
  const metadata =
    opts.metadataStore ??
    (pgClient ? new PostgresMetadataStore(pgClient) : new SqliteMetadataStore(db));

  const app = Fastify({
    logger: opts.logger ?? false,
    bodyLimit: MAX_BODY_BYTES,
  });

  // Treat octet-stream bodies as raw Buffers — no JSON parsing.
  app.addContentTypeParser("application/octet-stream", { parseAs: "buffer" }, (_req, body, done) =>
    done(null, body),
  );

  await app.register(rateLimit, {
    max: (req) => {
      const tokenOrg = req.token?.org;
      if (tokenOrg && opts.rateLimit?.perOrg?.[tokenOrg] !== undefined) {
        return opts.rateLimit.perOrg[tokenOrg];
      }
      return opts.rateLimit?.defaultsPerMinute ?? 600;
    },
    timeWindow: "1 minute",
    keyGenerator: (req) => req.token?.org ?? req.ip,
    allowList: (req) => req.routeOptions.url === "/v1/health",
  });

  // #region -- Security / auth hooks -----------------------

  app.addHook("onRequest", async (_req, reply) => {
    reply
      .header("X-Content-Type-Options", "nosniff")
      .header("Referrer-Policy", "no-referrer")
      .header("Cache-Control", "no-store");
  });

  app.addHook("onRequest", async (req, reply) => {
    if (
      req.routeOptions.url === "/v1/health" ||
      req.routeOptions.url === "/v1/auth/login" ||
      req.routeOptions.url === "/v1/auth/tailscale" ||
      req.routeOptions.url === "/v1/auth/keyname/session" ||
      req.routeOptions.url === "/" ||
      req.routeOptions.url === "/login" ||
      req.routeOptions.url === "/files" ||
      req.routeOptions.url === "/releases" ||
      req.routeOptions.url === "/storage" ||
      req.routeOptions.url === "/repos" ||
      req.routeOptions.url === "/users" ||
      req.routeOptions.url === "/grants" ||
      req.routeOptions.url === "/tokens" ||
      req.routeOptions.url === "/audit" ||
      req.routeOptions.url === "/settings" ||
      req.routeOptions.url === "/settings/webhooks" ||
      req.routeOptions.url === "/settings/integrations" ||
      req.routeOptions.url === "/logs" ||
      req.routeOptions.url === "/webui/*"
    )
      return;

    const header = req.headers.authorization;
    const cookieToken = parseCookies(req.headers.cookie).auth_token;
    if ((typeof header !== "string" || !header.startsWith("Bearer ")) && !cookieToken) {
      recordAudit(db, {
        org: "-",
        tokenId: null,
        action: "auth_fail",
        path: req.url,
        status: 401,
        ip: req.ip,
      });
      reply.code(401).send({ error: "PLUTO_INVALID_TOKEN" });
      return reply;
    }
    const plaintext =
      typeof header === "string" && header.startsWith("Bearer ")
        ? header.slice("Bearer ".length).trim()
        : cookieToken!;
    try {
      req.token = await auth.verifyToken(plaintext);
      const warning = sourceWarning(db, req, req.token);
      if (warning) {
        app.log.warn(
          {
            org: req.token.org,
            tokenId: req.token.id,
            service: req.token.service,
            ip: req.ip,
            warning,
          },
          "pluto source warning",
        );
        recordAudit(db, {
          org: req.token.org,
          tokenId: req.token.id,
          action: "warning",
          path: req.url,
          status: 299,
          ip: req.ip,
          warning,
        });
      }
    } catch (err: unknown) {
      const code = err instanceof PlutoError ? err.code : "PLUTO_INVALID_TOKEN";
      recordAudit(db, {
        org: "-",
        tokenId: null,
        action: "auth_fail",
        path: req.url,
        status: 401,
        ip: req.ip,
      });
      reply.code(401).send({ error: code });
      return reply;
    }
  });

  // #endregion ---------------------------------------------

  // #region -- Routes --------------------------------------

  const sendWebUi = async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.header("Content-Type", "text/html; charset=utf-8").send(webUiHtml());
  app.get("/", sendWebUi);
  app.get("/login", sendWebUi);
  app.get("/files", sendWebUi);
  app.get("/releases", sendWebUi);
  app.get("/storage", sendWebUi);
  app.get("/repos", sendWebUi);
  app.get("/users", sendWebUi);
  app.get("/grants", sendWebUi);
  app.get("/tokens", sendWebUi);
  app.get("/audit", sendWebUi);
  app.get("/settings", sendWebUi);
  app.get("/settings/webhooks", sendWebUi);
  app.get("/settings/integrations", sendWebUi);
  app.get("/logs", sendWebUi);

  app.get("/webui/*", async (req, reply) => {
    const path = webUiAssetPath((req.params as { "*": string })["*"]);
    if (!path) return reply.code(404).send({ error: "PLUTO_NOT_FOUND" });
    return reply.header("Content-Type", contentType(path)).send(readFileSync(path));
  });

  app.get("/v1/health", async () => ({
    ok: true,
    version,
    releaseSnapshot: process.env.DOTLOCKER_RELEASE_SNAPSHOT ?? null,
  }));

  app.get("/v1/operations/storage", async (req, reply) => {
    const token = req.token!;
    if (!token.userEmail || !(await auth.isOrgAdmin(token.userEmail, token.org)))
      return reply.code(403).send({ error: "PLUTO_FORBIDDEN" });
    const files = await metadata.listFiles(token.org);
    const objects = await store.listOrg(token.org);
    const metadataPaths = new Set(files.map((file) => file.path));
    const objectPaths = new Set(objects);
    const missing = files.filter((file) => !objectPaths.has(file.path)).map((file) => file.path);
    const orphaned = objects.filter((path) => !metadataPaths.has(path));
    return {
      backend: process.env.DOTLOCKER_S3_ENDPOINT ? "garage" : "filesystem",
      connected: true,
      bucket: process.env.DOTLOCKER_S3_BUCKET ?? null,
      files: files.length,
      bytes: files.reduce((total, file) => total + file.size, 0),
      objects: objects.length,
      missing: missing.slice(0, 100),
      orphaned: orphaned.slice(0, 100),
      checkedAt: Date.now(),
    };
  });

  app.post("/v1/auth/keyname/session", async (req, reply) => {
    const header = headerValue(req.headers.authorization);
    if (!header?.startsWith("Bearer "))
      return reply.code(401).send({ error: "PLUTO_KEYNAME_AUTH_REQUIRED" });
    try {
      const identity = await verifyKeynameSession(header.slice("Bearer ".length).trim());
      const user = await resolveOrBootstrapKeynameIdentity(auth, {
        subject: identity.subject,
        email: identity.userEmail,
        emailVerified: true,
      });
      const orgs = await auth.accessibleOrgs(user.email);
      const org = orgs[0];
      if (!org) return reply.code(403).send({ error: "PLUTO_FORBIDDEN" });
      const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
      const { plaintext, record } = await auth.mintToken({
        org,
        scopes: [{ path: `${org}/_session`, access: "read" }],
        label: `keyname:${identity.subject}`,
        expiresAt,
        userEmail: user.email,
      });
      const priorCookie = parseCookies(req.headers.cookie).auth_token;
      if (priorCookie) {
        try {
          const prior = await auth.verifyToken(priorCookie);
          if (prior.userEmail === user.email && isSessionToken(prior))
            await auth.revokeToken(prior.id);
        } catch {
          // An absent, expired, or already-revoked prior cookie is safe to ignore.
        }
      }
      setAuthCookies(reply, plaintext, record.id, expiresAt);
      recordAudit(db, {
        org,
        tokenId: record.id,
        action: "auth",
        path: "keyname/session",
        status: 200,
        ip: req.ip,
      });
      return reply.send({ org, orgs, userEmail: user.email, expiresAt });
    } catch (err: unknown) {
      if (err instanceof PlutoError) return reply.code(err.status || 500).send({ error: err.code });
      app.log.warn(err);
      return reply.code(401).send({ error: "PLUTO_KEYNAME_AUTH_FAILED" });
    }
  });

  app.post("/v1/auth/tailscale", async (req, reply) => {
    if (
      (process.env.DOTLOCKER_ENABLE_LEGACY_AUTH ?? process.env.PLUTO_ENABLE_LEGACY_AUTH) !==
        "true" ||
      (process.env.DOTLOCKER_TRUST_TAILSCALE_HEADERS ??
        process.env.PLUTO_TRUST_TAILSCALE_HEADERS) !== "true"
    )
      return reply.code(404).send({ error: "PLUTO_NOT_FOUND" });
    const body = req.body as { org?: string; label?: string; expiresSeconds?: number } | null;
    const email =
      headerValue(req.headers["tailscale-user-login"]) ??
      headerValue(req.headers["x-webauth-user"]);
    if (!email || !body?.org || !isValidOrgName(body.org))
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    try {
      if (!(await auth.hasAnyGrant(email.toLowerCase(), body.org)))
        return reply.code(403).send({ error: "PLUTO_FORBIDDEN" });
      const expiresAt = body.expiresSeconds
        ? Date.now() + Math.max(60, body.expiresSeconds) * 1000
        : Date.now() + 12 * 60 * 60 * 1000;
      const { plaintext, record } = await auth.mintToken({
        org: body.org,
        scopes: [{ path: `${body.org}/_session`, access: "read" }],
        label: body.label ?? `tailscale:${email.toLowerCase()}`,
        expiresAt,
        userEmail: email.toLowerCase(),
      });
      return reply.send({
        token: plaintext,
        tokenId: record.id,
        expiresAt,
        userEmail: email.toLowerCase(),
        grants: await auth.listUserGrants(email.toLowerCase(), body.org),
      });
    } catch (err: unknown) {
      if (err instanceof PlutoError) return reply.code(err.status || 500).send({ error: err.code });
      throw err;
    }
  });

  app.post("/v1/auth/login", async (req, reply) => {
    if (
      (process.env.DOTLOCKER_ENABLE_LEGACY_AUTH ?? process.env.PLUTO_ENABLE_LEGACY_AUTH) !== "true"
    )
      return reply.code(410).send({ error: "PLUTO_KEYNAME_AUTH_REQUIRED" });
    const body = req.body as {
      email?: string;
      password?: string;
      org?: string;
      label?: string;
      expiresSeconds?: number;
      totp?: string;
    } | null;
    if (!body?.email || !body.password)
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    try {
      const user = await auth.assertPassword(body.email, body.password);
      if (user.verifiedAt === null)
        return reply.code(401).send({ error: "PLUTO_EMAIL_UNVERIFIED" });
      if (
        (await auth.isTotpEnabled(user.email)) &&
        !(await auth.verifyTotp(user.email, body.totp ?? ""))
      )
        return reply.code(401).send({ error: "PLUTO_INVALID_TOKEN", mfaRequired: true });
      const orgs = await auth.accessibleOrgs(user.email);
      const org = body.org && isValidOrgName(body.org) ? body.org : orgs[0];
      if (!org || !(await auth.hasAnyGrant(user.email, org)))
        return reply.code(403).send({ error: "PLUTO_FORBIDDEN" });
      const expiresAt = body.expiresSeconds
        ? Date.now() + Math.max(60, body.expiresSeconds) * 1000
        : Date.now() + 12 * 60 * 60 * 1000;
      const { plaintext, record } = await auth.mintToken({
        org,
        scopes: [{ path: `${org}/_session`, access: "read" }],
        label: body.label ?? `login:${user.email}`,
        expiresAt,
        userEmail: user.email,
      });
      setAuthCookies(reply, plaintext, record.id, expiresAt);
      recordAudit(db, {
        org,
        tokenId: record.id,
        action: "auth",
        path: "login",
        status: 200,
        ip: req.ip,
      });
      return reply.send({
        token: plaintext,
        tokenId: record.id,
        expiresAt,
        user,
        org,
        orgs,
        grants: await auth.listUserGrants(user.email, org),
      });
    } catch (err: unknown) {
      if (err instanceof PlutoError) return reply.code(err.status || 500).send({ error: err.code });
      throw err;
    }
  });

  app.post("/v1/auth/switch-org", async (req, reply) => {
    const token = req.token!;
    const body = req.body as { org?: string } | null;
    if (!token.userEmail || !body?.org || !isValidOrgName(body.org))
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    if (!(await auth.hasAnyGrant(token.userEmail, body.org)))
      return reply.code(403).send({ error: "PLUTO_FORBIDDEN" });
    await auth.switchTokenOrg(token.id, body.org);
    const scopes = [{ path: `${body.org}/_session`, access: "read" as const }];
    recordAudit(db, {
      org: body.org,
      tokenId: token.id,
      action: "auth",
      path: "switch-org",
      status: 200,
      ip: req.ip,
    });
    return reply.send({
      token: {
        id: token.id,
        org: body.org,
        userEmail: token.userEmail,
        service: token.service,
        scopes,
        expiresAt: token.expiresAt,
      },
      identityEmail: (await auth.keynameIdentity(token.userEmail)) ?? token.userEmail,
      orgs: await auth.accessibleOrgs(token.userEmail),
      grants: await auth.listUserGrants(token.userEmail, body.org),
    });
  });

  app.post("/v1/auth/logout", async (req, reply) => {
    const token = req.token!;
    audit(db, req, token, "auth", "logout", 204);
    if (isSessionToken(token)) await auth.revokeToken(token.id);
    clearAuthCookies(reply);
    return reply.code(204).send();
  });

  app.get("/v1/me", async (req) => {
    const token = req.token!;
    return {
      token: {
        id: token.id,
        org: token.org,
        userEmail: token.userEmail,
        service: token.service,
        scopes: token.scopes,
        expiresAt: token.expiresAt,
      },
      identityEmail: token.userEmail
        ? ((await auth.keynameIdentity(token.userEmail)) ?? token.userEmail)
        : undefined,
      orgs: token.userEmail ? await auth.accessibleOrgs(token.userEmail) : [],
      grants: token.userEmail ? await auth.listUserGrants(token.userEmail, token.org) : [],
    };
  });

  app.post("/v1/orgs", async (req, reply) => {
    const token = req.token!;
    const body = req.body as { name?: string } | null;
    const name = body?.name?.trim().toLowerCase();
    if (!token.userEmail || !name || !isValidOrgName(name))
      return reply.code(400).send({ error: "PLUTO_INVALID_ORG" });
    try {
      await auth.createOrganization(name, token.userEmail);
      audit(db, req, token, "org", name, 201);
      return reply.code(201).send({ org: name });
    } catch (err: unknown) {
      if (err instanceof PlutoError) return reply.code(err.status || 500).send({ error: err.code });
      throw err;
    }
  });

  app.get("/v1/tokens", async (req) => {
    const token = req.token!;
    const allRows = await auth.listTokens(token.org);
    const admin = token.userEmail ? await auth.isOrgAdmin(token.userEmail, token.org) : false;
    const visible = allRows.filter(
      (t) => token.userEmail && (t.userEmail === token.userEmail || admin),
    );
    const shape = (t: TokenRecord) => ({
      id: t.id,
      org: t.org,
      label: t.label,
      userEmail: t.userEmail,
      service: t.service,
      scopes: t.scopes,
      createdAt: t.createdAt,
      expiresAt: t.expiresAt,
      revokedAt: t.revokedAt,
    });
    return {
      tokens: visible.filter((t) => !isSessionToken(t)).map(shape),
      sessions: visible.filter(isSessionToken).map(shape),
    };
  });

  app.post("/v1/tokens", async (req, reply) => {
    const token = req.token!;
    const body = req.body as {
      label?: string;
      scopes?: Array<{ path: string; access: Access }>;
      expiresSeconds?: number;
    } | null;
    if (!token.userEmail || !Array.isArray(body?.scopes) || body.scopes.length === 0)
      return reply.code(400).send({ error: "PLUTO_INVALID_SCOPE" });
    for (const s of body.scopes) {
      if (
        !authorize(token.scopes, s.path, s.access) &&
        !(await authorizeGrantForScope(auth, token.userEmail, s.path, s.access))
      )
        return reply.code(403).send({ error: "PLUTO_FORBIDDEN" });
    }
    const expiresAt = body.expiresSeconds
      ? Date.now() + Math.max(60, body.expiresSeconds) * 1000
      : null;
    const minted = await auth.mintToken({
      org: token.org,
      scopes: body.scopes,
      label: body.label ?? `api:${token.userEmail}`,
      expiresAt,
      userEmail: token.userEmail,
    });
    audit(db, req, token, "token", minted.record.id, 200);
    return reply.send({
      token: minted.plaintext,
      record: { ...minted.record, plaintext: undefined },
    });
  });

  app.delete("/v1/tokens/:id", async (req, reply) => {
    const token = req.token!;
    const id = (req.params as { id: string }).id;
    const target = (await auth.listTokens(token.org)).find((t) => t.id === id);
    if (!target) return reply.code(404).send({ error: "PLUTO_NOT_FOUND" });
    if (
      !token.userEmail ||
      (target.userEmail !== token.userEmail && !(await auth.isOrgAdmin(token.userEmail, token.org)))
    )
      return reply.code(403).send({ error: "PLUTO_FORBIDDEN" });
    await auth.revokeToken(id);
    audit(db, req, token, "token", id, 204);
    return reply.code(204).send();
  });

  app.post("/v1/users", async (req, reply) => {
    const token = req.token!;
    const body = req.body as { email?: string; org?: string } | null;
    const org = body?.org ?? token.org;
    if (!body?.email || !isValidOrgName(org))
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    try {
      await auth.requireOrgAdmin(token.userEmail, org);
      const user = await auth.createUser({
        email: body.email,
        password: randomBytes(48).toString("base64url"),
        verified: true,
      });
      audit(db, req, token, "user", body.email.toLowerCase(), 200);
      return reply.send({ user });
    } catch (err: unknown) {
      if (err instanceof PlutoError) return reply.code(err.status || 500).send({ error: err.code });
      throw err;
    }
  });

  app.post("/v1/users/verify", async (req, reply) => {
    const token = req.token!;
    const body = req.body as { email?: string; org?: string } | null;
    const org = body?.org ?? token.org;
    if (!body?.email || !isValidOrgName(org))
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    try {
      await auth.requireOrgAdmin(token.userEmail, org);
      const user = verifyUserEmail(db, body.email);
      audit(db, req, token, "user", body.email.toLowerCase(), 200);
      return reply.send({ user });
    } catch (err: unknown) {
      if (err instanceof PlutoError) return reply.code(err.status || 500).send({ error: err.code });
      throw err;
    }
  });

  app.post("/v1/mfa/totp/setup", async (_req, reply) =>
    reply.code(410).send({ error: "PLUTO_KEYNAME_AUTH_REQUIRED" }),
  );

  app.post("/v1/mfa/totp/enable", async (_req, reply) =>
    reply.code(410).send({ error: "PLUTO_KEYNAME_AUTH_REQUIRED" }),
  );

  app.get("/v1/grants/:org", async (req, reply) => {
    const token = req.token!;
    const org = (req.params as { org: string }).org;
    if (!isValidOrgName(org)) return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    try {
      await auth.requireOrgAdmin(token.userEmail, org);
      return reply.send({ grants: await auth.listOrgGrants(org) });
    } catch (err: unknown) {
      if (err instanceof PlutoError) return reply.code(err.status || 500).send({ error: err.code });
      throw err;
    }
  });

  app.delete("/v1/grants", async (req, reply) => {
    const token = req.token!;
    const body = req.body as {
      email?: string;
      org?: string;
      repo?: string;
      runtime?: string;
    } | null;
    const org = body?.org ?? token.org;
    if (!body?.email || !isValidOrgName(org))
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    try {
      await auth.requireOrgAdmin(token.userEmail, org);
      await auth.revokeGrant({
        email: body.email,
        org,
        repo: body.repo ?? null,
        runtime: body.runtime ?? null,
      });
      audit(
        db,
        req,
        token,
        "grant",
        [org, body.repo, body.runtime, body.email].filter(Boolean).join("/"),
        204,
      );
      return reply.code(204).send();
    } catch (err: unknown) {
      if (err instanceof PlutoError) return reply.code(err.status || 500).send({ error: err.code });
      throw err;
    }
  });

  app.post("/v1/grants/org-admin", async (req, reply) => {
    const token = req.token!;
    const body = req.body as { email?: string; org?: string } | null;
    const org = body?.org ?? token.org;
    if (!body?.email || !isValidOrgName(org))
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    try {
      await auth.requireOrgAdmin(token.userEmail, org);
      const grant = await auth.grantOrgAdmin(body.email, org);
      audit(db, req, token, "grant", `${org}/${body.email}`, 200);
      return reply.send({ grant });
    } catch (err: unknown) {
      if (err instanceof PlutoError) return reply.code(err.status || 500).send({ error: err.code });
      throw err;
    }
  });

  app.post("/v1/grants/repo", async (req, reply) => {
    const token = req.token!;
    const body = req.body as {
      email?: string;
      org?: string;
      repo?: string;
      access?: GrantAccess;
    } | null;
    const org = body?.org ?? token.org;
    if (!body?.email || !body.repo || !body.access || !isValidOrgName(org))
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    try {
      await auth.requireOrgAdmin(token.userEmail, org);
      const grant = await auth.grantRepo({
        email: body.email,
        org,
        repo: body.repo,
        access: body.access,
      });
      audit(db, req, token, "grant", `${org}/${body.repo}/${body.email}`, 200);
      return reply.send({ grant });
    } catch (err: unknown) {
      if (err instanceof PlutoError) return reply.code(err.status || 500).send({ error: err.code });
      throw err;
    }
  });

  app.post("/v1/grants/runtime", async (req, reply) => {
    const token = req.token!;
    const body = req.body as {
      email?: string;
      org?: string;
      repo?: string;
      runtime?: string;
      access?: GrantAccess;
    } | null;
    const org = body?.org ?? token.org;
    if (!body?.email || !body.repo || !body.runtime || !body.access || !isValidOrgName(org))
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    try {
      await auth.requireOrgAdmin(token.userEmail, org);
      const grant = await auth.grantRuntime({
        email: body.email,
        org,
        repo: body.repo,
        runtime: body.runtime,
        access: body.access,
      });
      audit(db, req, token, "grant", `${org}/${body.repo}/${body.runtime}/${body.email}`, 200);
      return reply.send({ grant });
    } catch (err: unknown) {
      if (err instanceof PlutoError) return reply.code(err.status || 500).send({ error: err.code });
      throw err;
    }
  });

  app.get("/v1/audit/:org", async (req, reply) => {
    const token = req.token!;
    const org = (req.params as { org: string }).org;
    const limitRaw = Number((req.query as { limit?: string }).limit ?? 100);
    const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(500, limitRaw)) : 100;
    if (!isValidOrgName(org)) return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    try {
      await auth.requireOrgAdmin(token.userEmail, org);
      return reply.send({ audit: recentAudit(db, org, limit) });
    } catch (err: unknown) {
      if (err instanceof PlutoError) return reply.code(err.status || 500).send({ error: err.code });
      throw err;
    }
  });

  app.get("/v1/webhooks", async (req, reply) => {
    const token = req.token!;
    await auth.requireOrgAdmin(token.userEmail, token.org);
    return reply.send({ webhooks: listWebhooks(db, token.org) });
  });

  app.post("/v1/webhooks", async (req, reply) => {
    const token = req.token!;
    await auth.requireOrgAdmin(token.userEmail, token.org);
    const body = req.body as { name?: string; url?: string; events?: string[] } | null;
    if (!body?.name || !body.url || !Array.isArray(body.events))
      return reply.code(400).send({ error: "PLUTO_INVALID_BODY" });
    const result = createWebhook(db, {
      org: token.org,
      name: body.name,
      url: body.url,
      events: body.events,
    });
    audit(db, req, token, "webhook", result.webhook.id, 201);
    return reply.code(201).send(result);
  });

  app.patch("/v1/webhooks/:id", async (req, reply) => {
    const token = req.token!;
    await auth.requireOrgAdmin(token.userEmail, token.org);
    const id = (req.params as { id: string }).id;
    const body = req.body as {
      name?: string;
      url?: string;
      events?: string[];
      enabled?: boolean;
    } | null;
    if (!body) return reply.code(400).send({ error: "PLUTO_INVALID_BODY" });
    const webhook = updateWebhook(db, token.org, id, body);
    audit(db, req, token, "webhook", id, 200);
    return reply.send({ webhook });
  });

  app.delete("/v1/webhooks/:id", async (req, reply) => {
    const token = req.token!;
    await auth.requireOrgAdmin(token.userEmail, token.org);
    const id = (req.params as { id: string }).id;
    deleteWebhook(db, token.org, id);
    audit(db, req, token, "webhook", id, 204);
    return reply.code(204).send();
  });

  app.get("/v1/webhooks/:id/deliveries", async (req, reply) => {
    const token = req.token!;
    await auth.requireOrgAdmin(token.userEmail, token.org);
    const id = (req.params as { id: string }).id;
    return reply.send({ deliveries: listWebhookDeliveries(db, token.org, id) });
  });

  app.get("/v1/files-meta/*", async (req, reply) => {
    const token = req.token!;
    const rawPath = (req.params as { "*": string })["*"];
    const parts = rawPath.split("/").filter(Boolean);
    const [org, repo, runtime] = parts;
    if (!org || org !== token.org || !isValidOrgName(org))
      return reply.code(403).send({ error: "PLUTO_FORBIDDEN" });
    const records = [];
    for (const r of await metadata.listFiles(org, repo, runtime))
      if (
        authorize(token.scopes, r.path, "read") ||
        (await auth.authorizeGrant(token.userEmail, r.path, "read"))
      )
        records.push(r);
    return reply.send({ files: records });
  });

  app.get("/v1/files/*", async (req, reply) => {
    const token = req.token!;
    const rawPath = (req.params as { "*": string })["*"];
    const parsed = await parseAndAuthorize(auth, token, rawPath, "read");
    if (parsed instanceof PlutoError) {
      audit(db, req, token, "deny", rawPath, parsed.status);
      return reply.code(parsed.status).send({ error: parsed.code });
    }
    try {
      const segments = parsed.joined.split("/");
      const [org, repo, runtime, ...relativeParts] = segments;
      const committedFile =
        repo && runtime && relativeParts.length > 0 && (await metadata.hasHead(org, repo, runtime))
          ? await metadata.headFile(org, repo, runtime, relativeParts.join("/"))
          : null;
      if (
        repo &&
        runtime &&
        relativeParts.length > 0 &&
        (await metadata.hasHead(org, repo, runtime)) &&
        !committedFile
      )
        throw new NotFoundError(`'${parsed.joined}' not found in the committed runtime`);
      const buf = committedFile
        ? await store.readBlob(committedFile.sha256)
        : await store.read(parsed.joined);
      audit(db, req, token, "get", parsed.joined, 200);
      return reply.header("Content-Type", "application/octet-stream").send(buf);
    } catch (err: unknown) {
      if (err instanceof NotFoundError) {
        audit(db, req, token, "get", parsed.joined, 404);
        return reply.code(404).send({ error: err.code });
      }
      throw err;
    }
  });

  app.put("/v1/files/*", async (req, reply) => {
    const token = req.token!;
    const rawPath = (req.params as { "*": string })["*"];
    const parsed = await parseAndAuthorize(auth, token, rawPath, "write");
    if (parsed instanceof PlutoError) {
      audit(db, req, token, "deny", rawPath, parsed.status);
      return reply.code(parsed.status).send({ error: parsed.code });
    }
    if (
      !/^application\/octet-stream(?:;|$)/i.test(headerValue(req.headers["content-type"]) ?? "")
    ) {
      return reply.code(415).send({ error: "PLUTO_UNSUPPORTED_MEDIA_TYPE" });
    }
    const body = req.body;
    if (!Buffer.isBuffer(body)) {
      return reply.code(400).send({ error: "PLUTO_INVALID_BODY" });
    }
    try {
      await store.write(parsed.joined, body);
      await store.writeBlob(body);
      await metadata.upsertFile(parsed.joined, body, token.userEmail);
      audit(db, req, token, "put", parsed.joined, 204);
      return reply.code(204).send();
    } catch (err: unknown) {
      if (err instanceof PlutoError) {
        audit(db, req, token, "put", parsed.joined, err.status);
        return reply.code(err.status).send({ error: err.code });
      }
      throw err;
    }
  });

  app.delete("/v1/files/*", async (req, reply) => {
    const token = req.token!;
    const rawPath = (req.params as { "*": string })["*"];
    const parsed = await parseAndAuthorize(auth, token, rawPath, "write");
    if (parsed instanceof PlutoError) {
      audit(db, req, token, "deny", rawPath, parsed.status);
      return reply.code(parsed.status).send({ error: parsed.code });
    }
    try {
      await store.delete(parsed.joined);
    } catch (err: unknown) {
      if (!(err instanceof NotFoundError)) throw err;
    }
    await metadata.markDeleted(parsed.joined);
    audit(db, req, token, "delete", parsed.joined, 204);
    return reply.code(204).send();
  });

  app.put("/v1/runtimes/:org/:repo/:runtime/objects/:sha256", async (req, reply) => {
    const token = req.token!;
    const { org, repo, runtime, sha256 } = req.params as {
      org: string;
      repo: string;
      runtime: string;
      sha256: string;
    };
    if (
      !isValidOrgName(org) ||
      !isValidSegment(repo) ||
      !isValidSegment(runtime) ||
      !/^[a-f0-9]{64}$/.test(sha256)
    )
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    const prefix = `${org}/${repo}/${runtime}`;
    const authorized = await parseAndAuthorize(auth, token, `${prefix}/_`, "write");
    if (authorized instanceof PlutoError)
      return reply.code(authorized.status).send({ error: authorized.code });
    if (!/^application\/octet-stream(?:;|$)/i.test(headerValue(req.headers["content-type"]) ?? ""))
      return reply.code(415).send({ error: "PLUTO_UNSUPPORTED_MEDIA_TYPE" });
    if (!Buffer.isBuffer(req.body)) return reply.code(400).send({ error: "PLUTO_INVALID_BODY" });
    if (createHash("sha256").update(req.body).digest("hex") !== sha256)
      return reply.code(409).send({ error: "PLUTO_OBJECT_HASH_MISMATCH" });
    await store.writeBlob(req.body);
    return reply.code(204).send();
  });

  app.post("/v1/runtimes/:org/:repo/:runtime/versions", async (req, reply) => {
    const token = req.token!;
    const { org, repo, runtime } = req.params as { org: string; repo: string; runtime: string };
    if (!isValidOrgName(org) || !isValidSegment(repo) || !isValidSegment(runtime))
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    const prefix = `${org}/${repo}/${runtime}`;
    const authorized = await parseAndAuthorize(auth, token, `${prefix}/_`, "write");
    if (authorized instanceof PlutoError)
      return reply.code(authorized.status).send({ error: authorized.code });
    const body = req.body as {
      files?: RuntimeVersionFile[];
      expectedParentHash?: string | null;
    } | null;
    if (!Array.isArray(body?.files)) return reply.code(400).send({ error: "PLUTO_INVALID_BODY" });

    try {
      const manifest = new Map<string, RuntimeVersionFile>();
      for (const file of body.files) {
        const fullPath = normalizePath(`${prefix}/${file.path}`).joined;
        const relativePath = fullPath.slice(prefix.length + 1);
        if (
          !fullPath.startsWith(`${prefix}/`) ||
          relativePath !== file.path ||
          manifest.has(relativePath)
        )
          return reply.code(400).send({ error: "PLUTO_INVALID_BODY" });
        const object = await store.readBlob(file.sha256);
        if (object.length !== file.size)
          return reply.code(409).send({ error: "PLUTO_VERSION_MANIFEST_MISMATCH" });
        manifest.set(relativePath, file);
      }

      const result = await metadata.commitVersion({
        org,
        repo,
        runtime,
        files: body.files,
        createdBy: token.userEmail,
        expectedParentHash: body.expectedParentHash,
      });

      if (result.created) {
        for (const file of body.files) {
          const fullPath = `${prefix}/${file.path}`;
          const object = await store.readBlob(file.sha256);
          await store.write(fullPath, object);
          await metadata.upsertFile(fullPath, object, token.userEmail);
        }
        for (const current of await metadata.listFiles(org, repo, runtime)) {
          if (manifest.has(current.relPath)) continue;
          try {
            await store.delete(current.path);
          } catch (err: unknown) {
            if (!(err instanceof NotFoundError)) throw err;
          }
          await metadata.markDeleted(current.path);
        }
      }

      audit(db, req, token, "version", prefix, result.created ? 201 : 200);
      return reply.code(result.created ? 201 : 200).send(result);
    } catch (err: unknown) {
      if (err instanceof PlutoError) {
        const currentHash = (await metadata.head(org, repo, runtime))?.hash ?? null;
        return reply.code(err.status || 400).send({
          error: err.code,
          ...(err.status === 409
            ? { expectedParentHash: body.expectedParentHash ?? null, currentHash }
            : {}),
        });
      }
      return reply.code(400).send({ error: "PLUTO_INVALID_BODY" });
    }
  });

  app.get("/v1/runtimes/:org/:repo/:runtime/head", async (req, reply) => {
    const token = req.token!;
    const { org, repo, runtime } = req.params as { org: string; repo: string; runtime: string };
    if (!isValidOrgName(org) || !isValidSegment(repo) || !isValidSegment(runtime))
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    const prefix = `${org}/${repo}/${runtime}`;
    const authorized = await parseAndAuthorize(auth, token, `${prefix}/_`, "read");
    if (authorized instanceof PlutoError)
      return reply.code(authorized.status).send({ error: authorized.code });
    return reply.send({ version: await metadata.head(org, repo, runtime) });
  });

  app.get("/v1/runtimes/:org/:repo/:runtime/versions", async (req, reply) => {
    const token = req.token!;
    const { org, repo, runtime } = req.params as { org: string; repo: string; runtime: string };
    if (!isValidOrgName(org) || !isValidSegment(repo) || !isValidSegment(runtime))
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    const prefix = `${org}/${repo}/${runtime}`;
    const authorized = await parseAndAuthorize(auth, token, `${prefix}/_`, "read");
    if (authorized instanceof PlutoError)
      return reply.code(authorized.status).send({ error: authorized.code });
    return reply.send({ versions: await metadata.versions(org, repo, runtime) });
  });

  app.get("/v1/resolve/*", async (req, reply) => {
    const token = req.token!;
    const rawPath = (req.params as { "*": string })["*"];

    const parts = rawPath.split("/").filter(Boolean);
    if (parts.length < 2) {
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    }
    const [org, ...prefixParts] = parts;
    if (!isValidOrgName(org) || prefixParts.some((s) => !isValidSegment(s))) {
      return reply.code(400).send({ error: "PLUTO_INVALID_PATH" });
    }
    if (org !== token.org) {
      audit(db, req, token, "deny", rawPath, 403);
      return reply.code(403).send({ error: "PLUTO_FORBIDDEN" });
    }

    const repo = prefixParts[0]!;
    const runtime = prefixParts[1];
    const committed = await metadata.committedPaths(org, repo, runtime);
    const legacy = [];
    for (const path of await store.list([org, ...prefixParts].join("/"))) {
      const [pathOrg, pathRepo, pathRuntime] = path.split("/");
      if (!pathRepo || !pathRuntime || !(await metadata.hasHead(pathOrg!, pathRepo, pathRuntime)))
        legacy.push(path);
    }
    const allFiles = [...new Set([...legacy, ...committed])].sort();
    const visible = [];
    for (const p of allFiles)
      if (
        authorize(token.scopes, p, "read") ||
        (await auth.authorizeGrant(token.userEmail, p, "read"))
      )
        visible.push(p);
    audit(db, req, token, "resolve", rawPath, 200);
    return reply.send({ files: visible });
  });

  // #endregion ---------------------------------------------

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof PlutoError) {
      reply.code(err.status || 500).send({ error: err.code });
      return;
    }
    app.log.error(err);
    reply.code(500).send({ error: "PLUTO_INTERNAL" });
  });

  return app;
}

async function resolveOrBootstrapKeynameIdentity(
  auth: AuthStore,
  identity: { subject: string; email: string; emailVerified: boolean },
) {
  try {
    return await auth.resolveKeynameIdentity(identity);
  } catch (error) {
    if (
      !(error instanceof NotFoundError) ||
      (process.env.DOTLOCKER_BOOTSTRAP_FIRST_KEYNAME_USER ??
        process.env.PLUTO_BOOTSTRAP_FIRST_KEYNAME_USER) !== "true" ||
      !(await auth.isEmpty())
    )
      throw error;

    const email = identity.email.trim().toLowerCase();
    const allowedEmails = (
      process.env.DOTLOCKER_BOOTSTRAP_KEYNAME_EMAILS ??
      process.env.PLUTO_BOOTSTRAP_KEYNAME_EMAILS ??
      ""
    )
      .split(",")
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    const allowedDomains = (
      process.env.DOTLOCKER_BOOTSTRAP_KEYNAME_DOMAINS ??
      process.env.PLUTO_BOOTSTRAP_KEYNAME_DOMAINS ??
      ""
    )
      .split(",")
      .map((value) => value.trim().toLowerCase().replace(/^@/, ""))
      .filter(Boolean);
    const domain = email.split("@")[1] ?? "";
    if (!allowedEmails.includes(email) && !allowedDomains.includes(domain)) throw error;

    await auth.createUser({
      email,
      password: randomBytes(48).toString("base64url"),
      verified: true,
    });
    await auth.createOrganization(
      process.env.DOTLOCKER_BOOTSTRAP_ORG ?? process.env.PLUTO_BOOTSTRAP_ORG ?? "honeycluster",
      email,
    );
    return auth.resolveKeynameIdentity(identity);
  }
}

interface ParsedRequest {
  readonly org: string;
  readonly joined: string;
}

function isSessionToken(token: TokenRecord): boolean {
  return token.scopes.length === 1 && token.scopes[0]?.path === `${token.org}/_session`;
}

async function authorizeGrantForScope(
  auth: AuthStore,
  email: string,
  scopePath: string,
  access: Access,
): Promise<boolean> {
  const probe = scopePath.endsWith("/**") ? `${scopePath.slice(0, -3)}/_` : scopePath;
  try {
    return await auth.authorizeGrant(email, probe, access);
  } catch {
    return false;
  }
}

function accessibleOrgs(db: DB, email: string): string[] {
  const rows = db
    .prepare(
      `SELECT org FROM org_memberships WHERE email = ?
     UNION SELECT org FROM repo_grants WHERE email = ?
     UNION SELECT org FROM runtime_grants WHERE email = ?
     ORDER BY org`,
    )
    .all(email, email, email) as Array<{ org: string }>;
  return rows.map((r) => r.org);
}

function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(";")) {
    const [rawKey, ...rest] = part.trim().split("=");
    if (!rawKey) continue;
    out[rawKey] = decodeURIComponent(rest.join("="));
  }
  return out;
}

function setAuthCookies(
  reply: FastifyReply,
  token: string,
  refreshToken: string,
  expiresAt: number,
): void {
  const maxAge = Math.max(60, Math.floor((expiresAt - Date.now()) / 1000));
  const secure =
    (process.env.DOTLOCKER_COOKIE_SECURE ?? process.env.PLUTO_COOKIE_SECURE) === "true" ||
    process.env.NODE_ENV === "production";
  const attrs = `Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure ? "; Secure" : ""}`;
  reply.header("Set-Cookie", [
    `auth_token=${encodeURIComponent(token)}; ${attrs}`,
    `refresh_token=${encodeURIComponent(refreshToken)}; ${attrs}`,
  ]);
}

function clearAuthCookies(reply: FastifyReply): void {
  reply.header("Set-Cookie", [
    "auth_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
    "refresh_token=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0",
  ]);
}

function contentType(path: string): string {
  if (path.endsWith(".js")) return "text/javascript; charset=utf-8";
  if (path.endsWith(".css")) return "text/css; charset=utf-8";
  if (path.endsWith(".html")) return "text/html; charset=utf-8";
  if (path.endsWith(".svg")) return "image/svg+xml";
  if (path.endsWith(".json")) return "application/json; charset=utf-8";
  return "application/octet-stream";
}

async function parseAndAuthorize(
  auth: AuthStore,
  token: TokenRecord,
  rawPath: string,
  access: Access,
): Promise<ParsedRequest | PlutoError> {
  let parsed: { readonly org: string; readonly joined: string };
  try {
    parsed = normalizePath(rawPath);
  } catch (err: unknown) {
    if (err instanceof PlutoError) return err;
    throw err;
  }
  if (parsed.org !== token.org) {
    return new ForbiddenError();
  }
  if (
    !authorize(token.scopes, parsed.joined, access) &&
    !(await auth.authorizeGrant(token.userEmail, parsed.joined, access))
  ) {
    return new ForbiddenError();
  }
  return parsed;
}

function audit(
  db: DB,
  req: FastifyRequest,
  token: TokenRecord | undefined,
  action: AuditAction,
  path: string,
  status: number,
): void {
  recordAudit(db, {
    org: token?.org ?? "-",
    tokenId: token?.id ?? null,
    action,
    path,
    status,
    ip: req.ip,
  });
}

function sourceWarning(db: DB, req: FastifyRequest, token: TokenRecord): string | null {
  if (!token.service) return null;
  const service = maybeGetService(db, token.org, token.service);
  const region =
    headerValue(req.headers["x-pluto-region"]) ??
    headerValue(req.headers["cf-ipcountry"]) ??
    headerValue(req.headers["x-vercel-ip-country"]);
  return serviceWarningForRequest(service, req.ip ?? null, region);
}

function headerValue(value: string | string[] | undefined): string | null {
  if (Array.isArray(value)) return value[0] ?? null;
  return value ?? null;
}

// #endregion ------------------------------------------------
