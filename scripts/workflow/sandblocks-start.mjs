#!/usr/bin/env node
import { mkdir, stat } from "node:fs/promises";
import { spawn } from "node:child_process";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createWriteStream } from "node:fs";
import { join, resolve } from "node:path";

const configuredDataDir = resolve(
  process.env.DOTLOCKER_DATA_DIR ?? process.env.PLUTO_DATA_DIR ?? "/data",
);
const archiveUrl = (
  process.env.DOTLOCKER_BOOTSTRAP_ARCHIVE_URL ?? process.env.PLUTO_BOOTSTRAP_ARCHIVE_URL
)?.trim();

const dataDir = await writableDataDirectory(configuredDataDir);
process.env.DOTLOCKER_DATA_DIR = dataDir;
if (archiveUrl && !(await exists(join(dataDir, "pluto.db")))) {
  const archive = join(dataDir, `.dotlocker-bootstrap-${process.pid}.tgz`);
  const response = await fetch(archiveUrl, { signal: AbortSignal.timeout(120_000) });
  if (!response.ok || !response.body)
    throw new Error(`dot.locker bootstrap download failed (${response.status})`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(archive, { mode: 0o600 }));
  await command("tar", ["-xzf", archive, "-C", dataDir]);
  await command("rm", ["-f", archive]);
  process.stdout.write("Initialized dot.locker preview data from managed bootstrap archive\n");
}

const cli = resolve("dist/cli.js");
const child = spawn(process.execPath, [cli, "serve"], { stdio: "inherit", env: process.env });
for (const signal of ["SIGINT", "SIGTERM"]) process.on(signal, () => child.kill(signal));
child.on("exit", (code, signal) => (process.exitCode = signal ? 1 : (code ?? 1)));

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch (error) {
    if (error?.code === "ENOENT") return false;
    throw error;
  }
}

async function writableDataDirectory(configured) {
  try {
    await mkdir(configured, { recursive: true });
    return configured;
  } catch (error) {
    if (!["EACCES", "EPERM", "ENOENT", "EROFS"].includes(error?.code)) throw error;
    const fallback = "/tmp/dotlocker-data";
    await mkdir(fallback, { recursive: true });
    process.stderr.write(
      `dot.locker data directory ${configured} is unavailable; using ${fallback}\n`,
    );
    return fallback;
  }
}

function command(program, args) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(program, args, { stdio: "inherit" });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolvePromise() : reject(new Error(`${program} exited ${code}`)),
    );
  });
}
