import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { chromium, type Browser, type Page } from "playwright";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildServer, createOrg, createUser, grantOrgAdmin, FileStore, openDb, type DB } from "../src/server/index.js";
import type { FastifyInstance } from "fastify";

describe("Pluto Web UI (Playwright)", () => {
  let root: string;
  let db: DB;
  let app: FastifyInstance;
  let browser: Browser;
  let page: Page;
  let baseUrl: string;

  beforeEach(async () => {
    root = mkdtempSync(join(tmpdir(), "pluto-webui-"));
    db = openDb(":memory:");
    createOrg(db, "acme");
    createUser(db, { email: "admin@example.com", password: "correct-horse-battery-staple", verified: true });
    grantOrgAdmin(db, "admin@example.com", "acme");
    app = await buildServer({ db, store: new FileStore({ root }), rateLimit: { defaultsPerMinute: 10000 } });
    await app.listen({ host: "127.0.0.1", port: 0 });
    const address = app.server.address();
    if (typeof address !== "object" || !address) throw new Error("server did not listen");
    baseUrl = `http://127.0.0.1:${address.port}`;
    browser = await chromium.launch({ headless: true });
    page = await browser.newPage();
  }, 30_000);

  afterEach(async () => {
    await page?.close().catch(() => undefined);
    await browser?.close().catch(() => undefined);
    await app?.close().catch(() => undefined);
    rmSync(root, { recursive: true, force: true });
  });

  it("loads and logs in", async () => {
    const pageErrors: string[] = [];
    page.on("pageerror", err => pageErrors.push(err.message));
    await page.goto(baseUrl + "/");
    await expect.poll(async () => page.getByRole("heading", { name: "Pluto Console" }).count()).toBeGreaterThan(0);
    await page.fill("#org", "acme");
    await page.fill("#email", "admin@example.com");
    await page.fill("#password", "correct-horse-battery-staple");
    await page.click("#login");
    await page.waitForTimeout(500);
    const status = await page.locator("#status").textContent();
    const output = await page.locator("#output").textContent();
    expect(`${status}\n${output}\n${pageErrors.join("\n")}`).toContain("Logged in");
    expect(await page.locator("#sessionEmail").textContent()).toContain("admin@example.com");
    expect(await page.locator("#identity").textContent()).toContain("admin@example.com");
  }, 30_000);
});
