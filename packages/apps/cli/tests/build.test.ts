import { describe, it, expect } from "vitest";
import { execFileSync } from "node:child_process";
import { existsSync, statSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const distCli = resolve(__dirname, "..", "dist", "cli.js");
const hasDistCli = existsSync(distCli);

describe("pluto built CLI (dist/cli.js)", () => {
  it.skipIf(!hasDistCli)("emits a non-empty bundle (> 2kB)", () => {
    // The entry is a thin launcher; the real code lives in dist/chunks/*, so
    // measure the entry plus its chunks.
    const chunksDir = resolve(__dirname, "..", "dist", "chunks");
    let size = statSync(distCli).size;
    if (existsSync(chunksDir)) {
      for (const f of readdirSync(chunksDir)) {
        if (f.endsWith(".js")) size += statSync(resolve(chunksDir, f)).size;
      }
    }
    expect(size).toBeGreaterThan(2048);
  });

  it.skipIf(!hasDistCli)("prints the command list when invoked with --help", () => {
    const stdout = execFileSync(process.execPath, [distCli, "--help"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    });

    expect(stdout).toContain("pluto");
    expect(stdout).toContain("serve");
    expect(stdout).toContain("pull");
    expect(stdout).toContain("exec");
  });

  it.skipIf(!hasDistCli)("exits 0 on --help", () => {
    let exitCode = -1;
    try {
      execFileSync(process.execPath, [distCli, "--help"], {
        stdio: ["ignore", "pipe", "pipe"],
      });
      exitCode = 0;
    } catch (err: unknown) {
      const e = err as { status?: number };
      exitCode = typeof e.status === "number" ? e.status : -1;
    }
    expect(exitCode).toBe(0);
  });
});
