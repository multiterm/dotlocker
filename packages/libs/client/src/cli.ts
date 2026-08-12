// #region -- Client CLI subcommands ------------------------

import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { basename, dirname, join, relative } from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import prompts from "prompts";
import type { Argv, CommandModule } from "yargs";
import {
  resolveClient,
  resolveFramework,
  type CliFlags,
  type ResolvedClient,
  type ResolvedFramework,
} from "./config.js";
import { PlutoClient } from "./http.js";
import { ConfigError, PlutoError } from "@dotlocker/shared";

interface CommonFlags extends CliFlags {
  readonly cwd?: string;
}

function commonOptions(yargs: Argv): Argv<CommonFlags> {
  return yargs
    .option("server", { type: "string", describe: "dot.locker server URL" })
    .option("token", { type: "string", describe: "Bearer token (env: DOTLOCKER_TOKEN; legacy: PLUTO_TOKEN)" })
    .option("org", { type: "string" })
    .option("repo", { type: "string", describe: "Repository namespace under org" })
    .option("runtime", { type: "string", describe: "Runtime namespace (dev, preview, prod, ...)" })
    .option("target-dir", { type: "string", describe: "Local directory to sync (default: .locker)" })
    .option("config", {
      type: "string",
      alias: "c",
      describe: "Explicit config file path",
    }) as Argv<CommonFlags>;
}

async function resolve(flags: CommonFlags): Promise<ResolvedClient> {
  return resolveClient({
    flags,
    cwd: flags.cwd ?? process.cwd(),
    prompt: process.stdin.isTTY ? interactivePrompt : null,
  });
}

async function interactivePrompt(field: "server" | "token" | "org" | "repo"): Promise<string> {
  const meta = {
    server: { message: "dot.locker server URL", mask: false },
    token: { message: "Auth token", mask: true },
    org: { message: "Organization", mask: false },
    repo: { message: "Repository", mask: false },
  } as const;
  const m = meta[field];
  const res = await prompts({
    type: m.mask ? "password" : "text",
    name: "value",
    message: m.message,
  });
  if (typeof res.value !== "string")
    throw new ConfigError("PLUTO_CONFIG_MISSING", `${field} not provided`, field);
  return res.value;
}

const initCommand: CommandModule<unknown, CommonFlags & { readonly force?: boolean }> = {
  command: "init",
  describe: "Write dotlocker.config.json at the workspace root",
  builder: (y) =>
    commonOptions(y).option("force", {
      type: "boolean",
      default: false,
      describe: "Overwrite existing config file",
    }) as Argv<CommonFlags & { force?: boolean }>,
  handler: async (args) => {
    const target = join(args.cwd ?? process.cwd(), "dotlocker.config.json");
    if (existsSync(target) && !args.force) {
      process.stderr.write(`'${target}' exists. Re-run with --force to overwrite.\n`);
      process.exit(1);
    }
    const r = await resolve(args);
    writeFileSync(
      target,
      JSON.stringify(
        { server: r.server, org: r.org, repo: r.repo, runtime: r.runtime, targetDir: r.targetDir },
        null,
        2,
      ) + "\n",
      { mode: 0o644 },
    );
    process.stdout.write(`wrote ${target}\n`);
  },
};

const pullCommand: CommandModule<unknown, CommonFlags & { readonly out?: string }> = {
  command: "pull",
  describe: "Cloud pull: fetch files for org/repo/runtime into the local target directory",
  builder: (y) =>
    commonOptions(y).option("out", {
      type: "string",
      describe: "Override target directory",
    }) as Argv<CommonFlags & { out?: string }>,
  handler: async (args) => {
    const r = await resolve(args);
    await pullFiles(r, args.out ?? r.targetDir);
  },
};

const stageCommand: CommandModule<
  unknown,
  CommonFlags & { readonly dir?: string; readonly out?: string }
> = {
  command: "stage [dir]",
  describe:
    "Framework-only: stage files for the selected runtime locally without contacting dot.locker cloud",
  builder: (y) =>
    commonOptions(y)
      .positional("dir", {
        type: "string",
        describe: "Directory to stage from (default: targetDir)",
      })
      .option("out", {
        type: "string",
        describe: "Directory to write staged files (default: same as source dir)",
      }) as Argv<CommonFlags & { dir?: string; out?: string }>,
  handler: async (args) => {
    const r = await resolveFramework({ flags: args, cwd: args.cwd ?? process.cwd(), prompt: null });
    stageFiles(r, args.dir ?? r.targetDir, args.out ?? r.targetDir);
  },
};

const syncCommand: CommandModule<unknown, CommonFlags & { readonly out?: string }> = {
  command: "sync",
  describe:
    "Cloud sync: pull every repo/runtime file visible to this token into runtime directories",
  builder: (y) =>
    commonOptions(y).option("out", {
      type: "string",
      describe: "Override target directory",
    }) as Argv<CommonFlags & { out?: string }>,
  handler: async (args) => {
    const r = await resolve(args);
    await syncFiles(r, args.out ?? r.targetDir);
  },
};

const execCommand: CommandModule<unknown, CommonFlags> = {
  command: "exec",
  describe: "Pull files, then exec a command",
  builder: (y) => commonOptions(y),
  handler: async (args) => {
    const rest = args._.map(String).filter((a) => a !== "exec");
    const [bin, ...rest2] = rest;
    if (!bin) {
      process.stderr.write("usage: dotlocker exec -- <command> [args...]\n");
      process.exit(2);
    }
    const r = await resolve(args);
    await pullFiles(r, r.targetDir);
    const child = spawn(bin, rest2, { env: process.env, stdio: "inherit" });
    child.on("exit", (code) => process.exit(code ?? 1));
  },
};

const pushCommand: CommandModule<unknown, CommonFlags & { readonly dir?: string }> = {
  command: "push [dir]",
  describe: "Upload every file in the local target directory for org/repo/runtime",
  builder: (y) =>
    commonOptions(y).positional("dir", {
      type: "string",
      describe: "Directory to upload (default: targetDir)",
    }) as Argv<CommonFlags & { dir?: string }>,
  handler: async (args) => {
    const r = await resolve(args);
    const dir = args.dir ?? r.targetDir;
    const files = listRuntimeFiles(dir, r);
    if (files.length === 0)
      throw new PlutoError(
        "PLUTO_NOT_FOUND",
        `no files to upload in ${dir} for runtime '${r.runtime}'`,
        404,
      );
    const client = new PlutoClient({ server: r.server, token: r.token });
    const expectedParentHash = (await client.runtimeHead(r.org, r.repo, r.runtime))?.hash ?? null;
    const manifest: Array<{ path: string; sha256: string; size: number }> = [];
    for (const file of files) {
      const body = readFileSync(join(dir, file.localRel));
      const sha256 = createHash("sha256").update(body).digest("hex");
      await client.putRuntimeObject(r.org, r.repo, r.runtime, sha256, body);
      manifest.push({ path: file.remoteRel, sha256, size: body.length });
      process.stdout.write(`staged ${file.localRel} -> ${sha256.slice(0, 12)}\n`);
    }
    const committed = await client.commitRuntime(
      r.org,
      r.repo,
      r.runtime,
      manifest,
      expectedParentHash,
    );
    process.stdout.write(
      committed.created
        ? `created runtime version ${committed.version.shortHash} (${committed.version.hash})\n`
        : `runtime unchanged at ${committed.version.shortHash}\n`,
    );
    process.stdout.write(`uploaded ${files.length} file(s) from ${dir} for runtime ${r.runtime}\n`);
  },
};

const versionsCommand: CommandModule<unknown, CommonFlags> = {
  command: "versions",
  describe: "List content-addressed versions for org/repo/runtime",
  builder: (y) => commonOptions(y),
  handler: async (args) => {
    const r = await resolve(args);
    const client = new PlutoClient({ server: r.server, token: r.token });
    const versions = await client.runtimeVersions(r.org, r.repo, r.runtime);
    for (const version of versions) {
      process.stdout.write(
        `${version.shortHash} ${version.hash} parent=${version.parentHash?.slice(0, 12) ?? "-"} files=${version.files.length} ${new Date(version.createdAt).toISOString()}\n`,
      );
    }
  },
};

const loginCommand: CommandModule<
  unknown,
  CommonFlags & { readonly email?: string; readonly password?: string; readonly totp?: string }
> = {
  command: "login",
  describe: "Login with email/password and print a short-lived token",
  builder: (y) =>
    commonOptions(y)
      .option("email", { type: "string", describe: "User email" })
      .option("password", { type: "string", describe: "User password" })
      .option("totp", { type: "string", describe: "TOTP code when MFA is enabled" }) as Argv<
      CommonFlags & { email?: string; password?: string; totp?: string }
    >,
  handler: async (args) => {
    const server = args.server ?? process.env.DOTLOCKER_SERVER ?? process.env.PLUTO_SERVER;
    const org = args.org ?? process.env.DOTLOCKER_ORG ?? process.env.PLUTO_ORG;
    const email = args.email ?? process.env.DOTLOCKER_EMAIL ?? process.env.PLUTO_EMAIL;
    const password = args.password ?? process.env.DOTLOCKER_PASSWORD ?? process.env.PLUTO_PASSWORD;
    if (!server || !org || !email || !password)
      throw new ConfigError(
        "PLUTO_CONFIG_MISSING",
        "login requires --server/DOTLOCKER_SERVER, --org/DOTLOCKER_ORG, --email/DOTLOCKER_EMAIL, and --password/DOTLOCKER_PASSWORD",
      );
    const client = new PlutoClient({ server, token: "" });
    const res = await client.login(email, password, org, args.totp ?? process.env.DOTLOCKER_TOTP ?? process.env.PLUTO_TOTP);
    process.stdout.write(`${res.token}\n`);
  },
};

const statusCommand: CommandModule<unknown, CommonFlags> = {
  command: "status",
  describe: "Print resolved config + server reachability",
  builder: (y) => commonOptions(y),
  handler: async (args) => {
    const r = await resolve(args);
    const maskedToken =
      r.token.length > 12 ? r.token.slice(0, 4) + "***" + r.token.slice(-4) : "***";
    process.stdout.write(
      [
        `server     ${r.server}    (${r.sources.server})`,
        `org        ${r.org}        (${r.sources.org})`,
        `repo       ${r.repo}        (${r.sources.repo})`,
        `runtime    ${r.runtime}        (${r.sources.runtime})`,
        `targetDir  ${r.targetDir}        (${r.sources.targetDir})`,
        `token      ${maskedToken}         (${r.sources.token})`,
        "",
      ].join("\n"),
    );
    const client = new PlutoClient({ server: r.server, token: r.token });
    const h = await client.health();
    process.stdout.write(`health     ok=${h.ok} version=${h.version}\n`);
  },
};

export const clientCommands: ReadonlyArray<CommandModule<unknown, never>> = [
  loginCommand as unknown as CommandModule<unknown, never>,
  initCommand as unknown as CommandModule<unknown, never>,
  pullCommand as unknown as CommandModule<unknown, never>,
  syncCommand as unknown as CommandModule<unknown, never>,
  execCommand as unknown as CommandModule<unknown, never>,
  pushCommand as unknown as CommandModule<unknown, never>,
  versionsCommand as unknown as CommandModule<unknown, never>,
  stageCommand as unknown as CommandModule<unknown, never>,
  statusCommand as unknown as CommandModule<unknown, never>,
];

async function pullFiles(r: ResolvedClient, targetDir: string): Promise<void> {
  const client = new PlutoClient({ server: r.server, token: r.token });
  const manifest = await client.resolve(r.org, r.repo, r.runtime);
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const pulled: Array<{ readonly path: string; readonly bytes: number }> = [];
  for (const file of manifest.files) {
    const rel = relativePrefix(r, file);
    if (rel === null) continue;
    const outPath = join(targetDir, rel);
    const body = await client.getFile(file);
    mkdirSync(dirname(outPath), { recursive: true, mode: 0o700 });
    writeFileSync(outPath, body, { mode: 0o600 });
    pulled.push({ path: rel, bytes: body.length });
    process.stdout.write(`wrote ${outPath}\n`);
  }
  writeDetails(targetDir, r, pulled, "pull");
  process.stdout.write(`pulled ${pulled.length} file(s) into ${targetDir}\n`);
}

async function syncFiles(r: ResolvedClient, targetDir: string): Promise<void> {
  const client = new PlutoClient({ server: r.server, token: r.token });
  const manifest = await client.resolve(r.org, r.repo, null);
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const synced: Array<{ readonly path: string; readonly bytes: number }> = [];
  const prefix = `${r.org}/${r.repo}/`;
  for (const file of manifest.files) {
    if (!file.startsWith(prefix)) continue;
    const rel = file.slice(prefix.length);
    const body = await client.getFile(file);
    const outPath = join(targetDir, rel);
    mkdirSync(dirname(outPath), { recursive: true, mode: 0o700 });
    writeFileSync(outPath, body, { mode: 0o600 });
    synced.push({ path: rel, bytes: body.length });
    process.stdout.write(`synced ${outPath}\n`);
  }
  writeDetails(targetDir, r, synced, "sync");
  process.stdout.write(`synced ${synced.length} file(s) into ${targetDir}\n`);
}

function stageFiles(r: ResolvedFramework, sourceDir: string, targetDir: string): void {
  const files = listRuntimeFiles(sourceDir, r);
  mkdirSync(targetDir, { recursive: true, mode: 0o700 });
  const staged: Array<{ readonly path: string; readonly bytes: number }> = [];
  for (const file of files) {
    const body = readFileSync(join(sourceDir, file.localRel));
    const outPath = join(targetDir, file.remoteRel);
    mkdirSync(dirname(outPath), { recursive: true, mode: 0o700 });
    writeFileSync(outPath, body, { mode: 0o600 });
    staged.push({ path: file.remoteRel, bytes: body.length });
    process.stdout.write(`staged ${file.localRel} -> ${outPath}\n`);
  }
  writeDetails(targetDir, r, staged, "stage");
  process.stdout.write(
    `staged ${files.length} file(s) for runtime ${r.runtime} into ${targetDir}\n`,
  );
}

function storagePrefix(r: Pick<ResolvedFramework, "org" | "repo" | "runtime">): string {
  return `${r.org}/${r.repo}/${r.runtime}`;
}

function relativePrefix(
  r: Pick<ResolvedFramework, "org" | "repo" | "runtime">,
  storage: string,
): string | null {
  const prefix = `${storagePrefix(r)}/`;
  if (!storage.startsWith(prefix)) return null;
  return storage.slice(prefix.length);
}

interface RuntimeFile {
  readonly localRel: string;
  readonly remoteRel: string;
  readonly specificity: number;
}

const DETAILS_FILE = "locker-details.json";

function listRuntimeFiles(
  root: string,
  r: Pick<ResolvedFramework, "runtime" | "runtimeNames">,
): readonly RuntimeFile[] {
  const all = listLocalFiles(root).filter((rel) => rel !== DETAILS_FILE);
  const mapped = new Map<string, RuntimeFile>();
  for (const localRel of all) {
    const candidate = runtimeRelativeForLocal(localRel, r);
    if (!candidate) continue;
    const existing = mapped.get(candidate.remoteRel);
    if (existing) {
      if (existing.specificity === candidate.specificity) {
        throw new PlutoError(
          "PLUTO_CONFIG_INVALID",
          `runtime file collision for '${candidate.remoteRel}': '${existing.localRel}' and '${candidate.localRel}' both map to the same remote path`,
          400,
        );
      }
      if (existing.specificity > candidate.specificity) continue;
    }
    mapped.set(candidate.remoteRel, candidate);
  }
  return Array.from(mapped.values()).sort((a, b) => a.remoteRel.localeCompare(b.remoteRel));
}

function runtimeRelativeForLocal(
  localRel: string,
  r: Pick<ResolvedFramework, "runtime" | "runtimeNames">,
): RuntimeFile | null {
  const parts = localRel.split("/");
  if (parts[0] === r.runtime) {
    return parts.length > 1
      ? { localRel, remoteRel: parts.slice(1).join("/"), specificity: 3 }
      : null;
  }
  if (parts.length === 1) {
    if (localRel.startsWith(`${r.runtime}.`)) {
      return { localRel, remoteRel: localRel.slice(r.runtime.length + 1), specificity: 3 };
    }
    if (localRel.endsWith(`.${r.runtime}`)) {
      return { localRel, remoteRel: localRel.slice(0, -(r.runtime.length + 1)), specificity: 3 };
    }
    for (const runtimeName of r.runtimeNames) {
      if (runtimeName === r.runtime) continue;
      if (localRel.startsWith(`${runtimeName}.`) || localRel.endsWith(`.${runtimeName}`))
        return null;
    }
  }
  if (r.runtimeNames.includes(parts[0])) return null;
  return { localRel, remoteRel: localRel, specificity: 1 };
}

function listLocalFiles(root: string): string[] {
  const out: string[] = [];
  function walk(dir: string): void {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const abs = join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile()) out.push(relative(root, abs).split("\\").join("/"));
    }
  }
  if (!existsSync(root) || !statSync(root).isDirectory()) return [];
  walk(root);
  return out.sort();
}

function writeDetails(
  targetDir: string,
  r: ResolvedFramework,
  files: readonly { readonly path: string; readonly bytes: number }[],
  mode: "pull" | "sync" | "stage",
): void {
  const updatedAt = new Date().toISOString();
  const totalBytes = files.reduce((sum, f) => sum + f.bytes, 0);
  const cloudGenerated = mode === "pull" || mode === "sync";
  const body = {
    mode,
    cloudGenerated,
    updatedAt,
    pulledAt: mode === "pull" ? updatedAt : null,
    syncedAt: mode === "sync" ? updatedAt : null,
    stagedAt: mode === "stage" ? updatedAt : null,
    lastUpdated: updatedAt,
    ...(cloudGenerated ? { username: currentUser() } : {}),
    org: r.org,
    repo: r.repo,
    runtime: r.runtime,
    targetDir,
    server: r.server ?? null,
    cloud: cloudGenerated,
    fileCount: files.length,
    totalBytes,
    files,
  };
  writeFileSync(join(targetDir, DETAILS_FILE), JSON.stringify(body, null, 2) + "\n", {
    mode: 0o600,
  });
}

function currentUser(): string {
  return (
    process.env.DOTLOCKER_USER ??
    process.env.PLUTO_USER ??
    process.env.GIT_AUTHOR_EMAIL ??
    process.env.USER ??
    process.env.USERNAME ??
    "unknown"
  );
}

// #endregion ------------------------------------------------
