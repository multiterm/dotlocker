// #region -- Client config resolution ----------------------

import { existsSync, readFileSync, statSync } from "node:fs";
import { basename, dirname, extname, isAbsolute, resolve } from "node:path";
import { createJiti } from "jiti";
import { z } from "zod";
import { ConfigError } from "@multiterm/pluto-shared";

const NAME_RE = /^[a-z0-9][a-z0-9._-]{0,62}$/;

export const clientConfigSchema = z.object({
  server: z.string().optional(),
  org: z
    .string()
    .regex(/^[a-z][a-z0-9-]{1,62}$/, "invalid org name")
    .optional(),
  repo: z.string().regex(NAME_RE, "invalid repo name").optional(),
  runtime: z.string().regex(NAME_RE, "invalid runtime name").optional(),
  targetDir: z.string().optional(),
  autoDetect: z.boolean().optional(),
  runtimeMap: z.record(z.string(), z.string()).optional(),
  token: z
    .never({
      error: "'token' must not be set in config files; use PLUTO_TOKEN env var or --token flag",
    })
    .optional(),
});

export type ClientConfig = z.infer<typeof clientConfigSchema>;

export const localSecretSchema = z.object({
  server: z.string().optional(),
  org: z.string().optional(),
  repo: z.string().optional(),
  runtime: z.string().optional(),
  targetDir: z.string().optional(),
  token: z.string().optional(),
});

export type LocalSecretConfig = z.infer<typeof localSecretSchema>;

export interface ResolvedFramework {
  readonly server?: string;
  readonly token?: string;
  readonly org: string;
  readonly repo: string;
  readonly runtime: string;
  readonly targetDir: string;
  /** Known runtime names used to avoid uploading other runtime directories. */
  readonly runtimeNames: readonly string[];
  readonly sources: Partial<Record<ResolvedFields, Source>>;
}

export interface ResolvedClient extends ResolvedFramework {
  readonly server: string;
  readonly token: string;
  readonly sources: Readonly<Record<ResolvedFields, Source>>;
}

export type Source = "flag" | "env" | "config" | "prompt" | "default";
type RequiredFields = "server" | "token" | "org" | "repo";
type ResolvedFields = RequiredFields | "runtime" | "targetDir";

export type FieldName = ResolvedFields;

export interface CliFlags {
  readonly server?: string;
  readonly token?: string;
  readonly org?: string;
  readonly repo?: string;
  readonly runtime?: string;
  readonly targetDir?: string;
  readonly config?: string;
}

export interface ConfigDiscoveryOptions {
  readonly cwd: string;
  readonly configPath?: string;
  readonly stopAt?: string;
}

export function discoverConfigFile(opts: ConfigDiscoveryOptions): string | null {
  if (opts.configPath) {
    const abs = isAbsolute(opts.configPath) ? opts.configPath : resolve(opts.cwd, opts.configPath);
    return existsSync(abs) ? abs : null;
  }
  const candidates = [
    "pluto.config.ts",
    "pluto.config.mjs",
    "pluto.config.js",
    "pluto.config.json",
    ".pluto.json",
  ];
  let dir = resolve(opts.cwd);
  for (let i = 0; i < 32; i++) {
    for (const c of candidates) {
      const p = resolve(dir, c);
      if (existsSync(p)) return p;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function discoverLocalSecretFile(cwd: string): string | null {
  let dir = resolve(cwd);
  for (let i = 0; i < 32; i++) {
    for (const name of [".pluto.local.json", ".pluto"]) {
      const p = resolve(dir, name);
      if (existsSync(p) && statSync(p).isFile()) return p;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

export function loadLocalSecretFile(path: string): LocalSecretConfig {
  try {
    const parsed = localSecretSchema.safeParse(JSON.parse(readFileSync(path, "utf-8")));
    if (!parsed.success) throw parsed.error;
    return parsed.data;
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      const first = err.issues[0];
      throw new ConfigError(
        "PLUTO_CONFIG_INVALID",
        `${path}: ${first.path.join(".")}: ${first.message}`,
        first.path.join("."),
      );
    }
    throw new ConfigError(
      "PLUTO_CONFIG_INVALID",
      `failed to parse '${path}': ${(err as Error).message}`,
    );
  }
}

export function loadConfigFile(path: string): ClientConfig {
  if (extname(path) !== ".json") {
    throw new ConfigError(
      "PLUTO_CONFIG_INVALID",
      `'${path}' is a ${extname(path)} config; use loadConfigFileAsync() or resolveClient()`,
    );
  }
  try {
    return parseConfigObject(path, JSON.parse(readFileSync(path, "utf-8")));
  } catch (err: unknown) {
    if (err instanceof ConfigError) throw err;
    throw new ConfigError(
      "PLUTO_CONFIG_INVALID",
      `failed to parse '${path}': ${(err as Error).message}`,
    );
  }
}

export async function loadConfigFileAsync(path: string): Promise<ClientConfig> {
  let raw: unknown;
  try {
    const ext = extname(path);
    raw =
      ext === ".ts" || ext === ".js" || ext === ".mjs"
        ? await createJiti(import.meta.url).import(path, { default: true })
        : JSON.parse(readFileSync(path, "utf-8"));
  } catch (err: unknown) {
    throw new ConfigError(
      "PLUTO_CONFIG_INVALID",
      `failed to load '${path}': ${(err as Error).message}`,
    );
  }
  return parseConfigObject(path, raw);
}

function parseConfigObject(path: string, raw: unknown): ClientConfig {
  const parsed = clientConfigSchema.safeParse(raw);
  if (!parsed.success) {
    const first = parsed.error.issues[0];
    throw new ConfigError(
      "PLUTO_CONFIG_INVALID",
      `${path}: ${first.path.join(".")}: ${first.message}`,
      first.path.join("."),
    );
  }
  return parsed.data;
}

export interface ResolveOptions {
  readonly flags: CliFlags;
  readonly cwd: string;
  readonly env?: NodeJS.ProcessEnv;
  readonly prompt?:
    | ((field: RequiredFields, current: Partial<Record<ResolvedFields, string>>) => Promise<string>)
    | null;
}

export async function resolveClient(opts: ResolveOptions): Promise<ResolvedClient> {
  const resolved = await resolveFramework(opts, true);
  return resolved as ResolvedClient;
}

export async function resolveFramework(
  opts: ResolveOptions,
  requireCloud = false,
): Promise<ResolvedFramework> {
  const env = opts.env ?? process.env;
  const configPath = discoverConfigFile({ cwd: opts.cwd, configPath: opts.flags.config });
  const fileConfig = configPath ? await loadConfigFileAsync(configPath) : {};
  const localSecretPath = discoverLocalSecretFile(opts.cwd);
  const localSecret = localSecretPath ? loadLocalSecretFile(localSecretPath) : {};

  const sources: Partial<Record<ResolvedFields, Source>> = {};
  const out: Partial<Record<ResolvedFields, string>> = {};

  for (const field of ["server", "token", "org", "repo"] as const) {
    const fromFlag = opts.flags[field];
    if (fromFlag) {
      out[field] = fromFlag;
      sources[field] = "flag";
      continue;
    }
    const envName = `PLUTO_${field.toUpperCase()}`;
    const fromEnv = env[envName];
    if (fromEnv) {
      out[field] = fromEnv;
      sources[field] = "env";
      continue;
    }
    const fromConfig = fileConfig[field];
    if (field !== "token" && fromConfig) {
      out[field] = fromConfig;
      sources[field] = "config";
      continue;
    }
    const fromLocal = localSecret[field];
    if (fromLocal) {
      out[field] = fromLocal;
      sources[field] = "config";
      continue;
    }
    if (field === "server" || field === "token") {
      if (!requireCloud) continue;
    }
    if (field === "org") {
      out.org = "local";
      sources.org = "default";
      continue;
    }
    if (field === "repo") {
      out.repo = basename(opts.cwd);
      sources.repo = "default";
      continue;
    }
    if (opts.prompt) {
      const v = await opts.prompt(field, out);
      if (!v) throw new ConfigError("PLUTO_CONFIG_MISSING", `field '${field}' is required`, field);
      out[field] = v;
      sources[field] = "prompt";
      continue;
    }
    throw new ConfigError(
      "PLUTO_CONFIG_MISSING",
      `field '${field}' is required (set --${field}, PLUTO_${field.toUpperCase()}, or add to ${configPath ?? "pluto.config.json"})`,
      field,
    );
  }

  const detectedRuntime = detectRuntime(fileConfig, env);
  const runtime =
    opts.flags.runtime ??
    env.PLUTO_RUNTIME ??
    fileConfig.runtime ??
    localSecret.runtime ??
    detectedRuntime ??
    "default";
  out.runtime = runtime;
  sources.runtime = opts.flags.runtime
    ? "flag"
    : env.PLUTO_RUNTIME
      ? "env"
      : fileConfig.runtime || localSecret.runtime || detectedRuntime
        ? "config"
        : "default";

  const targetDir =
    opts.flags.targetDir ??
    env.PLUTO_TARGET_DIR ??
    fileConfig.targetDir ??
    localSecret.targetDir ??
    ".pluto";
  out.targetDir = targetDir;
  sources.targetDir = opts.flags.targetDir
    ? "flag"
    : env.PLUTO_TARGET_DIR
      ? "env"
      : fileConfig.targetDir || localSecret.targetDir
        ? "config"
        : "default";

  return {
    server: out.server,
    token: out.token,
    org: out.org!,
    repo: out.repo!,
    runtime: out.runtime!,
    targetDir: out.targetDir!,
    runtimeNames: runtimeNames(fileConfig, out.runtime!),
    sources,
  };
}

function runtimeNames(config: ClientConfig, current: string): readonly string[] {
  return Array.from(
    new Set(
      [
        "default",
        "dev",
        "prod",
        "local",
        "preview",
        current,
        ...Object.values(config.runtimeMap ?? {}),
      ].filter((v) => NAME_RE.test(v)),
    ),
  ).sort();
}

function detectRuntime(config: ClientConfig, env: NodeJS.ProcessEnv): string | null {
  if (config.autoDetect === false) return null;
  const raw = env.PLUTO_RUNTIME_ENV ?? env.NODE_ENV;
  if (!raw) return null;
  const defaults: Record<string, string> = {
    production: "prod",
    development: "dev",
    local: "local",
    preview: "preview",
  };
  const mapped = config.runtimeMap?.[raw] ?? defaults[raw] ?? raw;
  return NAME_RE.test(mapped) ? mapped : null;
}

export function defineConfig(config: ClientConfig): ClientConfig {
  return config;
}

// #endregion ------------------------------------------------
