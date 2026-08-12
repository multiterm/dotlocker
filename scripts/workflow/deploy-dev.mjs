#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("../..", import.meta.url)));
const options = {
  host: process.env.PLUTO_STRATUS_HOST ?? "ansible@100.78.201.50",
  sshKey: process.env.PLUTO_STRATUS_SSH_KEY ?? "~/.ssh/ansible-honey",
  remoteRoot: process.env.PLUTO_STRATUS_ROOT ?? "/opt/pluto",
  action: "all",
  skipChecks: false,
  skipBuild: false,
  dryRun: false,
};

for (let index = 2; index < process.argv.length; index++) {
  const argument = process.argv[index];
  const next = () => {
    const value = process.argv[++index];
    if (!value) throw new Error(`${argument} requires a value`);
    return value;
  };
  if (argument === "--host") options.host = next();
  else if (argument === "--ssh-key") options.sshKey = next();
  else if (argument === "--remote-root") options.remoteRoot = next();
  else if (argument === "--action") options.action = next();
  else if (argument === "--skip-checks") options.skipChecks = true;
  else if (argument === "--skip-build") options.skipBuild = true;
  else if (argument === "--dry-run") options.dryRun = true;
  else if (argument === "--help" || argument === "-h") options.help = true;
  else throw new Error(`unknown argument: ${argument}`);
}
if (!new Set(["sync", "restart", "all"]).has(options.action))
  throw new Error("--action must be sync, restart, or all");
if (options.sshKey.startsWith("~/")) options.sshKey = join(homedir(), options.sshKey.slice(2));

function display(command, args) {
  return [command, ...args]
    .map((value) => (/\s/.test(value) ? JSON.stringify(value) : value))
    .join(" ");
}
function run(command, args, { capture = false } = {}) {
  console.log(`$ ${display(command, args)}`);
  if (options.dryRun) return "";
  const result = spawnSync(command, args, {
    cwd: root,
    encoding: capture ? "utf8" : undefined,
    stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
  });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(
      `${command} exited with status ${result.status}${capture ? `\n${result.stderr}` : ""}`,
    );
  return capture ? result.stdout : "";
}
function quote(value) {
  return `'${String(value).replaceAll("'", `'\\''`)}'`;
}
function sshArgs() {
  return ["-o", "BatchMode=yes", ...(options.sshKey ? ["-i", options.sshKey] : [])];
}
function ssh(command) {
  run("ssh", [...sshArgs(), options.host, command]);
}
function quality() {
  if (options.skipChecks) return;
  run("bun", ["run", "typecheck"]);
  run("bun", ["run", "test"]);
  run("bun", ["run", "build"]);
}
function sync() {
  const release = `/tmp/pluto-dev-${process.pid}`;
  ssh(`rm -rf ${quote(release)} && mkdir -p ${quote(release)}`);
  run("rsync", [
    "-az",
    "--delete",
    "--exclude=.git/",
    "--exclude=.env",
    "--exclude=.env.*",
    "--exclude=.pluto/",
    "--exclude=node_modules/",
    "--exclude=dist/",
    "-e",
    `ssh ${sshArgs().join(" ")}`,
    `${root}/`,
    `${options.host}:${release}/`,
  ]);
  const commands = [
    "set -euo pipefail",
    `sudo mkdir -p ${quote(options.remoteRoot)}`,
    `sudo rsync -a --delete --exclude=.env.dev --exclude=node_modules/ --exclude=dist/ ${quote(`${release}/`)} ${quote(`${options.remoteRoot}/`)}`,
    `sudo chown -R $(id -u):$(id -g) ${quote(options.remoteRoot)}`,
    `rm -rf ${quote(release)}`,
    `cd ${quote(options.remoteRoot)}`,
    "if [ ! -f .env.dev ]; then umask 077; printf 'PLUTO_POSTGRES_PASSWORD=%s\\nPLUTO_PORT=5175\\nPLUTO_IMAGE_TAG=dev\\nKEYNAME_ISSUER_URL=https://api.keyname.dev\\n' \"$(openssl rand -hex 32)\" > .env.dev; fi",
    "if ! grep -q '^PLUTO_BOOTSTRAP_FIRST_KEYNAME_USER=' .env.dev; then printf 'PLUTO_BOOTSTRAP_FIRST_KEYNAME_USER=false\\nPLUTO_BOOTSTRAP_ORG=honeycluster\\n' >> .env.dev; fi",
    options.skipBuild
      ? ":"
      : "sudo docker compose -p pluto-dev --env-file .env.dev -f scripts/workflow/docker-compose.deploy.yml build",
  ].join("; ");
  ssh(commands);
}
function restart() {
  const commands = [
    "set -euo pipefail",
    `cd ${quote(options.remoteRoot)}`,
    "test -f .env.dev",
    "sudo docker compose -p pluto-dev --env-file .env.dev -f scripts/workflow/docker-compose.deploy.yml up -d --remove-orphans",
    'for attempt in $(seq 1 60); do if curl -fsS http://127.0.0.1:5175/v1/health >/dev/null; then break; fi; if [ "$attempt" -eq 60 ]; then sudo docker compose -p pluto-dev --env-file .env.dev -f scripts/workflow/docker-compose.deploy.yml ps; exit 1; fi; sleep 2; done',
    "sudo docker compose -p pluto-dev --env-file .env.dev -f scripts/workflow/docker-compose.deploy.yml ps",
    "curl -fsS http://127.0.0.1:5175/v1/health",
  ].join("; ");
  ssh(commands);
}

if (options.help) {
  console.log(
    "Usage: node scripts/workflow/deploy-dev.mjs [--action sync|restart|all] [--host USER@HOST] [--ssh-key PATH] [--remote-root PATH] [--skip-checks] [--skip-build] [--dry-run]",
  );
  process.exit(0);
}
quality();
if (options.action === "sync" || options.action === "all") sync();
if (options.action === "restart" || options.action === "all") restart();
console.log(`Completed Pluto dev ${options.action} on Stratus (${options.host})`);
