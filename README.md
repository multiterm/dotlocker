# Pluto

[![CI](https://img.shields.io/github/actions/workflow/status/multiterm/pluto/ci.yml?branch=develop&label=CI)](https://github.com/multiterm/pluto/actions)
[![npm](https://img.shields.io/npm/v/@multiterm/pluto?label=%40multiterm%2Fpluto)](https://www.npmjs.com/package/@multiterm/pluto)
[![npm downloads](https://img.shields.io/npm/dm/@multiterm/pluto)](https://www.npmjs.com/package/@multiterm/pluto)
[![License](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

> Self-hosted, multi-tenant runtime file platform with scoped synchronization, version history, web administration, CLI/SDK access, and MCP tooling.

## Quick links

- [Documentation](./docs/)
- [Examples](./examples/)
- [Package layout](./docs/package-layout.md)
- [Sandblocks deployment](./docs/SANDBLOCKS-DEPLOYMENT.md)
- [Product roadmap](./docs/PRODUCT_ROADMAP.md)
- [CLI package documentation](./packages/libs/cli/README.md)
- [Issues](https://github.com/multiterm/pluto/issues)
- [Releases](https://github.com/multiterm/pluto/releases)

## Monorepo quicklinks

| Package/application | Path | Purpose |
| --- | --- | --- |
| [`@multiterm/pluto`](./packages/libs/cli/) | `packages/libs/cli` | Public server, workspace CLI, and SDK entry points |
| [`@multiterm/pluto-mcp`](./packages/apps/mcp/) | `packages/apps/mcp` | Deployable MCP runtime |
| [Web UI](./packages/apps/webui/) | `packages/apps/webui` | Private administration application |
| [Site](./packages/apps/site/) | `packages/apps/site` | Private marketing application |
| [Internal libraries](./packages/libs/) | `packages/libs/*` | Client, server, UI, design-system, and shared modules |

Pluto stores and serves bytes exactly as provided. It does **not** know or care whether files are plaintext, encrypted, JSON, env files, certificates, manifests, or any other format. If encryption is needed, encrypt before `pluto push` and decrypt after `pluto pull` in your own application/runtime layer.

Files are addressed by:

```txt
<org>/<repo>/<runtime>/<relative-file-path>
```

The client syncs a local target directory, defaulting to `.pluto`:

- `pluto push` uploads files for the selected runtime from the target directory.
- `pluto pull` downloads every file for the resolved `org/repo/runtime` and writes them into the target directory without runtime prefixes.

## Install

```sh
pnpm add -D @multiterm/pluto
```

The same `pluto` binary runs as the server and as the workspace client.

## Server quickstart

```sh
# Persist /data in a volume.
docker run -d --name pluto -p 3000:3000 -v pluto-data:/data ghcr.io/super-repo/pluto:latest

# Create an org.
docker exec -it pluto pluto org create acme

# Mint a repo/runtime scoped token.
docker exec -it pluto pluto token create \
  --org acme \
  --scope 'acme/portal/**:read' \
  --scope 'acme/portal/**:write' \
  --label 'portal-sync' \
  --expires 30d
```

The plaintext token is printed once. Store it securely.

## Development deployment

Development is deployed to the Stratus host at `100.78.201.50` and published through `https://pluto.honeycluster.xyz`. Run `bun run deploy:dev` or `pnpm exec rune deploy-dev-stratus`; see [`scripts/workflow/README.md`](scripts/workflow/README.md) for profiles, safeguards, and split sync/restart commands.

## Workspace quickstart

```sh
export PLUTO_TOKEN=plt_xxxx

# pluto.config.json, pluto.config.ts, etc.
pluto init

# Upload all files from .pluto to acme/portal/<runtime>/...
pluto push

# Pull all files for acme/portal/<runtime>/... into .pluto, replacing the directory.
pluto pull

# Sync every runtime file this token can read into .pluto/<runtime>/...
pluto sync

# Pull, then run a process.
pluto exec -- node app.js

pluto status
```

## Configuration

Committed config files must not contain tokens.

```ts
import { defineConfig } from '@multiterm/pluto/client'

export default defineConfig({
  server: 'https://pluto.example.com',
  org: 'acme',
  repo: 'portal',
  targetDir: '.pluto', // optional; default is .pluto
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
| `server` | `--server`, `PLUTO_SERVER`, config, local `.pluto`, prompt |
| `token` | `--token`, `PLUTO_TOKEN`, local `.pluto.local.json` or legacy file `.pluto`, prompt |
| `org` | `--org`, `PLUTO_ORG`, config, local `.pluto`, prompt |
| `repo` | `--repo`, `PLUTO_REPO`, config, local `.pluto`, prompt |
| `runtime` | `--runtime`, `PLUTO_RUNTIME`, config, `runtimeMap[NODE_ENV]`, default `default` |
| `targetDir` | `--target-dir`, `PLUTO_TARGET_DIR`, config, local `.pluto`, default `.pluto` |

A machine-local `.pluto.local.json` file may contain secrets and must be gitignored. Legacy file `.pluto` is still read only when it is a file; the default `.pluto/` target directory takes precedence for file sync.

```jsonc
{
  "server": "https://pluto.example.com",
  "org": "acme",
  "repo": "portal",
  "runtime": "preview",
  "targetDir": ".pluto",
  "token": "plt_..."
}
```

## Sync model

Given:

```txt
.pluto/
  config/app.json
  secrets.enc
  certs/tls.crt
```

With `org=acme`, `repo=portal`, `runtime=preview`, `pluto push` uploads:

```txt
acme/portal/preview/config/app.json
acme/portal/preview/secrets.enc
acme/portal/preview/certs/tls.crt
```

Runtime selection rules for `pluto push`:

- Files inside `<targetDir>/<runtime>/...` are uploaded with the runtime directory stripped.
- Root files named `<runtime>.<name>` are uploaded with the runtime prefix stripped.
- Root files named `<name>.<runtime>` are uploaded with the runtime suffix stripped. This supports env-style files such as `.env.preview -> .env`.
- Unprefixed files are also uploaded for the selected runtime.
- Known non-selected runtime directories/prefixes/suffixes such as `dev/`, `prod.`, `.preview`, and values from `runtimeMap` are ignored.
- If an unprefixed base file and a runtime-specific file map to the same output, the runtime-specific file wins. If two equally-specific runtime files collide, Pluto errors.

Each push stages content-addressed objects without changing the visible runtime, then atomically commits the complete tree with the head observed at push start. A concurrent head change returns `409` instead of overwriting another push. Pluto uses SHA-256 long hashes and 12-character short hashes. Pushing an identical tree leaves the current version unchanged; changing, adding, or removing a file appends a version whose `parentHash` points to the previous version. Run `pluto versions` to inspect the linear history. Pulls resolve only through committed heads, and interrupted staged uploads are never visible.

Example for `runtime=preview`:

```txt
.pluto/config/app.json       -> acme/portal/preview/config/app.json
.pluto/preview/secrets.enc   -> acme/portal/preview/secrets.enc
.pluto/preview.flags.json    -> acme/portal/preview/flags.json
.pluto/.env.preview          -> acme/portal/preview/.env
.pluto/prod/secrets.enc      -> ignored
.pluto/.env.prod             -> ignored
```

`pluto pull` lists the remote runtime prefix and writes files back without runtime prefixes:

```txt
acme/portal/preview/config/app.json -> .pluto/config/app.json
acme/portal/preview/secrets.enc     -> .pluto/secrets.enc
```

Pulls overwrite files they download, but they do not delete unrelated files in the target directory. After each pull, Pluto writes `.pluto/pluto-details.json` with metadata including `mode`, `cloudGenerated`, `updatedAt`, `pulledAt`, `username`, `org`, `repo`, `runtime`, `fileCount`, `totalBytes`, and the pulled file list. `username` is only included for cloud-generated pull/sync details. `pluto-details.json` is local metadata and is excluded from `pluto push`.

## Cloud sync and runtime gating

`pluto sync` pulls every file under `<org>/<repo>/...` that the token can read and preserves the cloud runtime directory layout locally:

```txt
acme/portal/dev/.env     -> .pluto/dev/.env
acme/portal/preview/.env -> .pluto/preview/.env
acme/portal/prod/.env    -> .pluto/prod/.env
```

Access is controlled by token scopes:

```sh
# Organization-wide key: all repos and all runtimes in the org.
pluto token create --org acme --scope 'acme/**:read' --scope 'acme/**:write' --label org-wide

# Repo admin: all runtimes for one repo.
pluto token create --org acme --scope 'acme/portal/**:read' --scope 'acme/portal/**:write' --label portal-admin

# Runtime-limited user: preview only for one repo.
pluto token create --org acme --scope 'acme/portal/preview/**:read' --label portal-preview-reader
```

Tokens may also be associated with a verified user via `--user <email>` for operator/audit metadata. Admins can grant access either with the operator CLI or over the API using an org-admin authenticated token.

Operator CLI:

```sh
pluto grant org-admin admin@example.com --org acme
pluto grant repo dev@example.com --org acme --repo portal --access read
pluto grant runtime qa@example.com --org acme --repo portal --runtime preview --access read
pluto grant list qa@example.com --org acme
```

## Framework-only mode

You can use Pluto without the cloud server as a local runtime-file staging framework:

```sh
pluto stage --runtime preview
```

`stage` applies the same runtime selection rules as `push`, but writes the selected files back to unprefixed root paths locally and never contacts the server. This lets a repo organize files by runtime while applications consume stable paths.

```txt
.pluto/config/app.json       -> .pluto/config/app.json
.pluto/preview/secrets.enc   -> .pluto/secrets.enc
.pluto/preview.flags.json    -> .pluto/flags.json
.pluto/prod/secrets.enc      -> ignored
```

`stage` also writes `.pluto/pluto-details.json` with `mode: "stage"`, `cloudGenerated: false`, and the same non-cloud metrics as cloud pulls.

## CLI

### Server-side

| Command | Purpose |
|---|---|
| `pluto serve` | Start the HTTP server |
| `pluto org create <name>` | Create an organization namespace |
| `pluto org list` | List organizations |
| `pluto token create --org --scope --label --expires` | Mint a scoped bearer token |
| `pluto token list --org <org>` | List tokens |
| `pluto token revoke <id>` | Revoke a token |
| `pluto user ...`, `pluto service ...` | Optional operator metadata/source-warning helpers |

### Workspace-side

| Command | Purpose |
|---|---|
| `pluto init` | Write `pluto.config.json` |
| `pluto push [dir]` | Upload runtime-selected files in `dir` or `targetDir` |
| `pluto pull [--out <dir>]` | Cloud pull one runtime into `targetDir` or `--out` as unprefixed files |
| `pluto sync [--out <dir>]` | Cloud sync all readable repo/runtime files into runtime directories |
| `pluto stage [dir] [--out <dir>]` | Framework-only local runtime staging; reads from `dir` or `targetDir`, writes to `targetDir` unless `--out` is provided; no server required |
| `pluto exec -- <cmd>` | Pull then execute a command |
| `pluto status` | Print resolved config and server health |
| `pluto versions` | List the selected runtime's short/long hashes and parent chain |

All client commands accept `--server`, `--token`, `--org`, `--repo`, `--runtime`, `--target-dir`, and `--config`.

## Web UI

Pluto serves its dashboard at `/` and a separate marketing app from `packages/apps/site`. The dashboard follows the Keypost console structure with grouped/collapsible navigation, page headers, an operational footer, an organization-admin logs page, and a secondary Settings sidebar for general preferences, signed webhooks, and integrations. Interactive sign-in uses `https://api.keyname.dev/auth.js` and Keyname's in-app modal. Pluto receives the modal's short-lived access token, verifies it server-side against Keyname, links the identity to the existing account, and continues to enforce Pluto grants and scoped API tokens.

Keyname's modal obtains per-user origin consent during sign-in, so Pluto does not require an OAuth client or a manually managed application allowlist. `KEYNAME_ISSUER_URL` defaults to `https://api.keyname.dev`; no client secret or redirect callback is used by Pluto. Existing users, grants, tokens, file metadata, and stored files are retained. The first successful login links a verified Keyname subject to the existing normalized email. Legacy password and trusted-header login are disabled unless `PLUTO_ENABLE_LEGACY_AUTH=true` is explicitly set for a bounded rollback window.

## HTTP API

| Route | Purpose |
|---|---|
| `GET /v1/health` | Health check, no auth |
| `POST /v1/auth/keyname/session` | Verify an auth.js modal access token with Keyname, link the identity, and establish a Pluto session |
| `POST /v1/auth/login` | Disabled legacy password flow; requires explicit `PLUTO_ENABLE_LEGACY_AUTH=true` rollback flag |
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
| `GET /v1/resolve/<org>/<repo>` | List visible files across all readable runtimes for `pluto sync` |
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

- Pluto stores bytes verbatim; encryption is caller-owned.
- Use TLS at the reverse proxy/load balancer.
- Keep tokens short-lived and scope them to the narrowest repo/runtime prefix possible.
- The server enforces org isolation and path normalization before touching disk.
- `PUT` requires `application/octet-stream`; responses are marked `Cache-Control: no-store`.
- Webhook payloads are signed as `HMAC-SHA256(<timestamp>.<raw-body>)`; verify `X-Pluto-Timestamp` and `X-Pluto-Signature` before processing.
- Production webhook destinations require HTTPS. Signing secrets are returned only when an endpoint is created.

## Contributing, security, and support

Use [GitHub Issues](https://github.com/multiterm/pluto/issues) for reproducible defects and proposals. Do not attach access tokens, synchronized file contents, or webhook signing secrets. Submit vulnerabilities through GitHub's private security advisory workflow.

## License

Released under the [MIT License](./LICENSE).
