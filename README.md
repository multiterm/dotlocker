# dot.locker

[![CI](https://img.shields.io/github/actions/workflow/status/multiterm/dotlocker/ci.yml?branch=develop&label=CI)](https://github.com/multiterm/dotlocker/actions)
[![npm](https://img.shields.io/npm/v/@dotlocker/dotlocker?label=%40dotlocker%2Fdotlocker)](https://www.npmjs.com/package/@dotlocker/dotlocker)
[![npm downloads](https://img.shields.io/npm/dm/@dotlocker/dotlocker)](https://www.npmjs.com/package/@dotlocker/dotlocker)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> Self-hosted, multi-tenant runtime file platform with scoped synchronization, version history, web administration, CLI/SDK access, and MCP tooling.

## Quick links

- [Documentation](./docs/)
- [Examples](./examples/)
- [Package layout](./docs/package-layout.md)
- [Technical specification](./docs/SPEC.md)
- [Agent skill](./docs/SKILL.md)
- [Sandblocks deployment](./docs/SANDBLOCKS-DEPLOYMENT.md)
- [Product roadmap](./docs/PRODUCT_ROADMAP.md)
- [CLI package documentation](./packages/libs/cli/README.md)
- [Issues](https://github.com/multiterm/dotlocker/issues)
- [Releases](https://github.com/multiterm/dotlocker/releases)
- [Migration from Pluto](./docs/MIGRATING-FROM-PLUTO.md)

## Monorepo quicklinks

| Package/application | Path | Purpose |
| --- | --- | --- |
| [`@dotlocker/dotlocker`](./packages/libs/cli/) | `packages/libs/cli` | Public server, workspace CLI, and SDK entry points |
| [`@dotlocker/mcp`](./packages/apps/mcp/) | `packages/apps/mcp` | Deployable MCP runtime |
| [Web UI](./packages/apps/webui/) | `packages/apps/webui` | Private administration application |
| [Site](./packages/apps/site/) | `packages/apps/site` | Private marketing application |
| [Internal libraries](./packages/libs/) | `packages/libs/*` | Client, server, UI, design-system, and shared modules |

dot.locker stores and serves bytes exactly as provided. It does **not** know or care whether files are plaintext, encrypted, JSON, env files, certificates, manifests, or any other format. If encryption is needed, encrypt before `dotlocker push` and decrypt after `dotlocker pull` in your own application/runtime layer.

Files are addressed by:

```txt
<org>/<repo>/<runtime>/<relative-file-path>
```

The client syncs a local target directory, defaulting to `.locker`:

- `dotlocker push` uploads files for the selected runtime from the target directory.
- `dotlocker pull` downloads every file for the resolved `org/repo/runtime` and writes them into the target directory without runtime prefixes.

## Install

```sh
pnpm add -D @dotlocker/dotlocker
```

The same `dotlocker` binary runs as the server and as the workspace client.

## Server quickstart

```sh
# Build locally, or run the complete PostgreSQL-backed stack.
docker build -f docker/Dockerfile -t dotlocker:local .
DOTLOCKER_POSTGRES_PASSWORD='replace-me' docker compose -f docker/docker-compose.yml up -d --build

# Create an org.
docker exec -it dotlocker dotlocker org create acme

# Mint a repo/runtime scoped token.
docker exec -it dotlocker dotlocker token create \
  --org acme \
  --scope 'acme/portal/**:read' \
  --scope 'acme/portal/**:write' \
  --label 'portal-sync' \
  --expires 30d
```

The plaintext token is printed once. Store it securely.

## Development deployment

Development is deployed through Sandblocks from the root [`sandblocks.yml`](./sandblocks.yml). Use `pnpm sandblocks:preview` for the first deployment, `pnpm sandblocks:redeploy` for later candidates, and `pnpm sandblocks:status` to inspect the current preview. See [Sandblocks deployment](./docs/SANDBLOCKS-DEPLOYMENT.md).

## Workspace quickstart

```sh
export DOTLOCKER_TOKEN=plt_xxxx

# dotlocker.config.json, dotlocker.config.ts, etc.
dotlocker init

# Upload all files from .locker to acme/portal/<runtime>/...
dotlocker push

# Pull all files for acme/portal/<runtime>/... into .locker, replacing the directory.
dotlocker pull

# Sync every runtime file this token can read into .locker/<runtime>/...
dotlocker sync

# Pull, then run a process.
dotlocker exec -- node app.js

dotlocker status
```

## Configuration

Committed config files must not contain tokens.

```ts
import { defineConfig } from '@dotlocker/dotlocker/client'

export default defineConfig({
  server: 'https://dotlocker.example.com',
  org: 'acme',
  repo: 'portal',
  targetDir: '.locker', // optional; default is .locker
  autoDetect: true,
  runtimeMap: {
    development: 'dev',
    production: 'prod',
    preview: 'preview',
  },
})
```

Resolution order:

| Field | Sources |
|---|---|
| `server` | `--server`, `DOTLOCKER_SERVER`, config, local `.locker`, prompt |
| `token` | `--token`, `DOTLOCKER_TOKEN`, local `.locker.local.json` or legacy file `.locker`, prompt |
| `org` | `--org`, `DOTLOCKER_ORG`, config, local `.locker`, prompt |
| `repo` | `--repo`, `DOTLOCKER_REPO`, config, local `.locker`, prompt |
| `runtime` | `--runtime`, `DOTLOCKER_RUNTIME`, config, `runtimeMap[NODE_ENV]`, default `default` |
| `targetDir` | `--target-dir`, `DOTLOCKER_TARGET_DIR`, config, local `.locker`, default `.locker` |

A machine-local `.locker.local.json` file may contain secrets and must be gitignored. Legacy `.pluto.local.json` and file-form `.pluto` are still read for one migration cycle; canonical `.locker` files take precedence.

```jsonc
{
  "server": "https://dotlocker.example.com",
  "org": "acme",
  "repo": "portal",
  "runtime": "preview",
  "targetDir": ".locker",
  "token": "plt_..."
}
```

## Sync model

Given:

```txt
.locker/
  config/app.json
  secrets.enc
  certs/tls.crt
```

With `org=acme`, `repo=portal`, `runtime=preview`, `dotlocker push` uploads:

```txt
acme/portal/preview/config/app.json
acme/portal/preview/secrets.enc
acme/portal/preview/certs/tls.crt
```

Runtime selection rules for `dotlocker push`:

- Files inside `<targetDir>/<runtime>/...` are uploaded with the runtime directory stripped.
- Root files named `<runtime>.<name>` are uploaded with the runtime prefix stripped.
- Root files named `<name>.<runtime>` are uploaded with the runtime suffix stripped. This supports env-style files such as `.env.preview -> .env`.
- Unprefixed files are also uploaded for the selected runtime.
- Known non-selected runtime directories/prefixes/suffixes such as `dev/`, `prod.`, `.preview`, and values from `runtimeMap` are ignored.
- If an unprefixed base file and a runtime-specific file map to the same output, the runtime-specific file wins. If two equally-specific runtime files collide, dot.locker errors.

Each push stages content-addressed objects without changing the visible runtime, then atomically commits the complete tree with the head observed at push start. A concurrent head change returns `409` instead of overwriting another push. dot.locker uses SHA-256 long hashes and 12-character short hashes. Pushing an identical tree leaves the current version unchanged; changing, adding, or removing a file appends a version whose `parentHash` points to the previous version. Run `dotlocker versions` to inspect the linear history. Pulls resolve only through committed heads, and interrupted staged uploads are never visible.

Example for `runtime=preview`:

```txt
.locker/config/app.json       -> acme/portal/preview/config/app.json
.locker/preview/secrets.enc   -> acme/portal/preview/secrets.enc
.locker/preview.flags.json    -> acme/portal/preview/flags.json
.locker/.env.preview          -> acme/portal/preview/.env
.locker/prod/secrets.enc      -> ignored
.locker/.env.prod             -> ignored
```

`dotlocker pull` lists the remote runtime prefix and writes files back without runtime prefixes:

```txt
acme/portal/preview/config/app.json -> .locker/config/app.json
acme/portal/preview/secrets.enc     -> .locker/secrets.enc
```

Pulls overwrite files they download, but they do not delete unrelated files in the target directory. After each pull, dot.locker writes `.locker/dotlocker-details.json` with metadata including `mode`, `cloudGenerated`, `updatedAt`, `pulledAt`, `username`, `org`, `repo`, `runtime`, `fileCount`, `totalBytes`, and the pulled file list. `username` is only included for cloud-generated pull/sync details. `dotlocker-details.json` is local metadata and is excluded from `dotlocker push`.

## Cloud sync and runtime gating

`dotlocker sync` pulls every file under `<org>/<repo>/...` that the token can read and preserves the cloud runtime directory layout locally:

```txt
acme/portal/dev/.env     -> .locker/dev/.env
acme/portal/preview/.env -> .locker/preview/.env
acme/portal/prod/.env    -> .locker/prod/.env
```

Access is controlled by token scopes:

```sh
# Organization-wide key: all repos and all runtimes in the org.
dotlocker token create --org acme --scope 'acme/**:read' --scope 'acme/**:write' --label org-wide

# Repo admin: all runtimes for one repo.
dotlocker token create --org acme --scope 'acme/portal/**:read' --scope 'acme/portal/**:write' --label portal-admin

# Runtime-limited user: preview only for one repo.
dotlocker token create --org acme --scope 'acme/portal/preview/**:read' --label portal-preview-reader
```

Tokens may also be associated with a verified user via `--user <email>` for operator/audit metadata. Admins can grant access either with the operator CLI or over the API using an org-admin authenticated token.

Operator CLI:

```sh
dotlocker grant org-admin admin@example.com --org acme
dotlocker grant repo dev@example.com --org acme --repo portal --access read
dotlocker grant runtime qa@example.com --org acme --repo portal --runtime preview --access read
dotlocker grant list qa@example.com --org acme
```

## Framework-only mode

You can use dot.locker without the cloud server as a local runtime-file staging framework:

```sh
dotlocker stage --runtime preview
```

`stage` applies the same runtime selection rules as `push`, but writes the selected files back to unprefixed root paths locally and never contacts the server. This lets a repo organize files by runtime while applications consume stable paths.

```txt
.locker/config/app.json       -> .locker/config/app.json
.locker/preview/secrets.enc   -> .locker/secrets.enc
.locker/preview.flags.json    -> .locker/flags.json
.locker/prod/secrets.enc      -> ignored
```

`stage` also writes `.locker/dotlocker-details.json` with `mode: "stage"`, `cloudGenerated: false`, and the same non-cloud metrics as cloud pulls.

## CLI

### Server-side

| Command | Purpose |
|---|---|
| `dotlocker serve` | Start the HTTP server |
| `dotlocker org create <name>` | Create an organization namespace |
| `dotlocker org list` | List organizations |
| `dotlocker token create --org --scope --label --expires` | Mint a scoped bearer token |
| `dotlocker token list --org <org>` | List tokens |
| `dotlocker token revoke <id>` | Revoke a token |
| `dotlocker user ...`, `dotlocker service ...` | Optional operator metadata/source-warning helpers |

### Workspace-side

| Command | Purpose |
|---|---|
| `dotlocker init` | Write `dotlocker.config.json` |
| `dotlocker push [dir]` | Upload runtime-selected files in `dir` or `targetDir` |
| `dotlocker pull [--out <dir>]` | Cloud pull one runtime into `targetDir` or `--out` as unprefixed files |
| `dotlocker sync [--out <dir>]` | Cloud sync all readable repo/runtime files into runtime directories |
| `dotlocker stage [dir] [--out <dir>]` | Framework-only local runtime staging; reads from `dir` or `targetDir`, writes to `targetDir` unless `--out` is provided; no server required |
| `dotlocker exec -- <cmd>` | Pull then execute a command |
| `dotlocker status` | Print resolved config and server health |
| `dotlocker versions` | List the selected runtime's short/long hashes and parent chain |

All client commands accept `--server`, `--token`, `--org`, `--repo`, `--runtime`, `--target-dir`, and `--config`.

## Web UI

dot.locker serves its dashboard at `/` and a separate marketing app from `packages/apps/site`. The dashboard follows the Keypost console structure with grouped/collapsible navigation, page headers, an operational footer, an organization-admin logs page, and a secondary Settings sidebar for general preferences, signed webhooks, and integrations. Interactive sign-in uses `https://api.keyname.dev/auth.js` and Keyname's in-app modal. dot.locker receives the modal's short-lived access token, verifies it server-side against Keyname, links the identity to the existing account, and continues to enforce dot.locker grants and scoped API tokens.

Keyname's modal obtains per-user origin consent during sign-in, so dot.locker does not require an OAuth client or a manually managed application allowlist. `KEYNAME_ISSUER_URL` defaults to `https://api.keyname.dev`; no client secret or redirect callback is used by dot.locker. Existing users, grants, tokens, file metadata, and stored files are retained. The first successful login links a verified Keyname subject to the existing normalized email. Legacy password and trusted-header login are disabled unless `DOTLOCKER_ENABLE_LEGACY_AUTH=true` is explicitly set for a bounded rollback window.

## HTTP API

| Route | Purpose |
|---|---|
| `GET /v1/health` | Health check, no auth |
| `POST /v1/auth/keyname/session` | Verify an auth.js modal access token with Keyname, link the identity, and establish a dot.locker session |
| `POST /v1/auth/login` | Disabled legacy password flow; requires explicit `DOTLOCKER_ENABLE_LEGACY_AUTH=true` rollback flag |
| `POST /v1/auth/tailscale` | Disabled legacy trusted-header flow; requires both legacy and Tailscale flags |
| `GET /v1/me` | Inspect token identity, scopes, and user grants |
| `GET /v1/tokens` | List own tokens, or org tokens for org admins |
| `POST /v1/tokens` | Mint a scoped API token limited to the caller's grants |
| `DELETE /v1/tokens/<id>` | Revoke own token, or any org token for org admins |
| `POST /v1/users` | Org admin provisions an email for later Keyname identity linking |
| `POST /v1/users/verify` | Legacy account verification endpoint retained for data compatibility |
| `POST /v1/mfa/totp/setup` | Retired; MFA is managed by Keyname |
| `POST /v1/mfa/totp/enable` | Retired; MFA is managed by Keyname |
| `GET /v1/grants/<org>` | Org admin lists grants |
| `DELETE /v1/grants` | Org admin revokes a grant |
| `POST /v1/grants/org-admin` | Org admin grants org admin access |
| `POST /v1/grants/repo` | Org admin grants repo access |
| `POST /v1/grants/runtime` | Org admin grants runtime access |
| `GET /v1/files/<org>/<repo>/<runtime>/<path>` | Download raw bytes |
| `PUT /v1/files/<org>/<repo>/<runtime>/<path>` | Upload raw bytes, `application/octet-stream`; updates file metadata |
| `DELETE /v1/files/<org>/<repo>/<runtime>/<path>` | Tombstone file metadata; blob removal is planned |
| `GET /v1/files-meta/<org>/<repo>/<runtime>` | List DB metadata visible to this token |
| `GET /v1/audit/<org>` | Org admin reads recent audit events |
| `GET /v1/webhooks` | Org admin lists signed webhook endpoints |
| `POST /v1/webhooks` | Org admin creates an endpoint and receives its signing secret once |
| `PATCH /v1/webhooks/<id>` | Org admin updates or pauses an endpoint |
| `DELETE /v1/webhooks/<id>` | Org admin deletes an endpoint |
| `GET /v1/webhooks/<id>/deliveries` | Org admin reads recent delivery outcomes |
| `GET /v1/resolve/<org>/<repo>/<runtime>` | List visible files under the runtime prefix |
| `GET /v1/resolve/<org>/<repo>` | List visible files across all readable runtimes for `dotlocker sync` |
| `PUT /v1/runtimes/<org>/<repo>/<runtime>/objects/<sha256>` | Stage and hash-verify an immutable object without changing the runtime |
| `POST /v1/runtimes/<org>/<repo>/<runtime>/versions` | Atomically commit a manifest with optional `expectedParentHash` |
| `GET /v1/runtimes/<org>/<repo>/<runtime>/head` | Read the currently committed runtime head |
| `GET /v1/runtimes/<org>/<repo>/<runtime>/versions` | List content-addressed runtime history |

## Scope grammar

Scopes match full storage paths:

- `*` matches exactly one path segment.
- `**` matches one or more trailing segments and must be the final token.
- Scopes must start with the token org.
- Traversal, absolute paths, empty path segments, unsupported glob syntax, and non-normalized unicode are rejected.

Examples:

```sh
--scope 'acme/portal/prod/**:read'
--scope 'acme/portal/preview/**:write'
--scope 'acme/portal/*/config.json:read'
```

## Security notes

- dot.locker stores bytes verbatim; encryption is caller-owned.
- Use TLS at the reverse proxy/load balancer.
- Keep tokens short-lived and scope them to the narrowest repo/runtime prefix possible.
- The server enforces org isolation and path normalization before touching disk.
- `PUT` requires `application/octet-stream`; responses are marked `Cache-Control: no-store`.
- Webhook payloads are signed as `HMAC-SHA256(<timestamp>.<raw-body>)`; verify `X-dot.locker-Timestamp` and `X-dot.locker-Signature` before processing.
- Production webhook destinations require HTTPS. Signing secrets are returned only when an endpoint is created.

## Contributing, security, and support

Use [GitHub Issues](https://github.com/multiterm/dotlocker/issues) for reproducible defects and proposals. Do not attach access tokens, synchronized file contents, or webhook signing secrets. Submit vulnerabilities through GitHub's private security advisory workflow.

## License

Released under the [MIT License](./LICENSE).
