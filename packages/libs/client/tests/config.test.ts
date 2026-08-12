import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveClient, resolveFramework, discoverConfigFile, discoverLocalSecretFile, loadConfigFile, loadConfigFileAsync, loadLocalSecretFile } from "../src/index.js";
import { ConfigError } from "@multiterm/pluto-shared";

describe("client config resolution", () => {
  let cwd: string;
  beforeEach(() => { cwd = mkdtempSync(join(tmpdir(), "pluto-cfg-")); });
  afterEach(() => rmSync(cwd, { recursive: true, force: true }));

  it("discovers config files", () => {
    const sub = join(cwd, "packages", "api");
    mkdirSync(sub, { recursive: true });
    const p = join(cwd, "pluto.config.json");
    writeFileSync(p, "{}");
    expect(discoverConfigFile({ cwd: sub })).toBe(p);
  });

  it("loads local .pluto with token", async () => {
    const p = join(cwd, ".pluto");
    writeFileSync(p, JSON.stringify({ server: "https://x", org: "acme", repo: "portal", runtime: "preview", token: "plt_token" }));
    expect(discoverLocalSecretFile(cwd)).toBe(p);
    expect(loadLocalSecretFile(p).token).toBe("plt_token");
    const r = await resolveClient({ cwd, env: {}, flags: {}, prompt: null });
    expect(r.repo).toBe("portal");
    expect(r.runtime).toBe("preview");
    expect(r.targetDir).toBe(".pluto");
  });

  it("loads typed config", async () => {
    const p = join(cwd, "pluto.config.ts");
    writeFileSync(p, "export default { server: 'https://x', org: 'acme', repo: 'portal', runtimeMap: { production: 'prod' } }\n");
    const cfg = await loadConfigFileAsync(p);
    expect(cfg.repo).toBe("portal");
  });

  it("rejects token in committed config", () => {
    const p = join(cwd, "pluto.config.json");
    writeFileSync(p, JSON.stringify({ token: "leaked", org: "acme" }));
    expect(() => loadConfigFile(p)).toThrow(ConfigError);
  });

  it("flag wins over env wins over config", async () => {
    writeFileSync(join(cwd, "pluto.config.json"), JSON.stringify({ server: "config", org: "acme", repo: "portal" }));
    const r = await resolveClient({
      cwd,
      env: { PLUTO_TOKEN: "env-token", PLUTO_SERVER: "env-server" },
      flags: { server: "flag-server", repo: "flag-repo" },
      prompt: null,
    });
    expect(r.server).toBe("flag-server");
    expect(r.repo).toBe("flag-repo");
    expect(r.token).toBe("env-token");
  });

  it("detects runtime from NODE_ENV", async () => {
    writeFileSync(join(cwd, "pluto.config.json"), JSON.stringify({ server: "https://x", org: "acme", repo: "portal", runtimeMap: { production: "prod" } }));
    const r = await resolveClient({ cwd, env: { PLUTO_TOKEN: "token", NODE_ENV: "production" }, flags: {}, prompt: null });
    expect(r.runtime).toBe("prod");
  });

  it("resolves framework mode without server or token", async () => {
    writeFileSync(join(cwd, "pluto.config.json"), JSON.stringify({ org: "acme", repo: "portal", runtimeMap: { preview: "preview" } }));
    const r = await resolveFramework({ cwd, env: { NODE_ENV: "preview" }, flags: {}, prompt: null });
    expect(r.server).toBeUndefined();
    expect(r.token).toBeUndefined();
    expect(r.repo).toBe("portal");
    expect(r.runtime).toBe("preview");
    expect(r.targetDir).toBe(".pluto");
  });
});
