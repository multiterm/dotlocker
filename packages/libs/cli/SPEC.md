# Pluto — Encrypted env-file delivery server

> Self-hosted, multi-tenant HTTP server that stores and serves encrypted `.env*` files. Clients authenticate with bearer tokens scoped to hierarchical paths; the server only ever sees ciphertext, decryption happens client-side using the existing envx/dotenvx wire format.

## Design decisions (locked)

| Decision | Choice |
|---|---|
| Storage paths | Hierarchical `<org>/<team>/<service>/...` |
| Tenancy | Multi-tenant, `<org>` is the enforced top segment |
| Hosting | Self-host only — no managed offering |
| Push authority | `read` / `write` are independent verbs per scope; one token cannot combine `<org>/**` read with **any** write |
| Encryption keys | Per-leaf-service keypair; workstation `.env.keys` aggregates them |
| Scope grammar | `*` = one segment, `**` = trailing-only multi-segment, no braces, no extglob, no mid-path `**` |
| Wire format | Unchanged envx/dotenvx ECIES — server stores and serves ciphertext bytes verbatim |

## Why two keys

Auth token controls **which files you can fetch**. `.env.keys` controls **which values you can decrypt**. They are orthogonal — a leaked token yields ciphertext that is useless without the matching private key; a leaked private key is useless without server access. This separation is the entire security story.

## Wire model

```
client                              pluto server                fs
  │   GET /v1/files/acme/api/...      │                          │
  │   Authorization: Bearer sk_xxx    │                          │
  ├──────────────────────────────────►│  auth + scope match      │
  │                                   ├─────────────────────────►│
  │   ciphertext bytes                │                          │
  │◄──────────────────────────────────┤◄─────────────────────────┤
  │                                   │                          │
  │   read local .env.keys            │                          │
  │   decrypt with matching private   │                          │
  │   key, exec target command        │                          │
```

## Path grammar

A storage path is `<org>/<segment>/<segment>/.../<env-file>`, where:

- `<org>` matches `[a-z][a-z0-9-]{1,62}`
- Each non-leaf `<segment>` matches `[a-z0-9][a-z0-9-]{0,62}`
- Leaf `<env-file>` matches `\.env(\.[a-z0-9][a-z0-9-]{0,32})*`
- Max 8 segments total, max 512 bytes total path length

Anything that fails this grammar is rejected at the single chokepoint (`src/path.ts:normalize`). No `..`, no leading `/`, no mixed separators, no symlinks, no hidden-file segments, no unicode normalization tricks. The chokepoint is the entire path-traversal attack surface.

## Scope grammar

Scopes are bound to tokens and matched against requested paths:

- `*` matches exactly one segment
- `**` matches one or more trailing segments — **must be the last token**
- No mid-path `**` (rejected at scope-creation time)
- No brace expansion, no extglob, no character classes
- Every scope MUST start with a literal `<org>` segment (no `*/...` or `**`-only scopes)

Examples:

| Scope | Matches | Rejects |
|---|---|---|
| `acme/payments/api/.env.prod` | exact only | anything else |
| `acme/payments/*/.env.prod` | one segment under `payments` | `acme/payments/api/v2/.env.prod` |
| `acme/payments/**` | everything under payments | `acme/billing/...` |
| `acme/**` | everything in org | other orgs |

## Token model

```ts
interface Token {
  readonly id: string;          // tok_<random>
  readonly org: string;         // enforced top-segment isolation
  readonly scopes: readonly TokenScope[];
  readonly createdAt: number;   // unix ms
  readonly expiresAt: number | null;
  readonly revokedAt: number | null;
  readonly label: string;       // human-readable for audit log
}

interface TokenScope {
  readonly path: string;        // glob, must start with `${org}/`
  readonly access: "read" | "write";
}
```

**Mint-time invariants:**

1. Every scope's path must start with the token's `org` segment.
2. A token containing any `write` scope must not also contain a broad-read scope (`<org>/**` or `<org>/*` patterns where `*` is the *only* remaining content). Operators must mint narrow publish tokens deliberately.
3. Scope paths must not contain mid-path `**`.

Token storage: hash on insert (argon2id), compare on lookup. Plaintext token returned only once at mint time.

## API surface

All routes require `Authorization: Bearer <token>` except `/v1/health`. The auth hook resolves the token, binds `req.org` and `req.scopes`, and rejects any path whose first segment does not match `req.org`.

### `GET /v1/files/<org>/<path>`

Returns the raw ciphertext bytes of the requested env file.

- Requires a `read` scope matching `<org>/<path>`.
- 200 → `application/octet-stream`, body is the ciphertext file contents (unchanged from disk).
- 404 if file does not exist.
- 403 if no scope matches.
- 401 if no/invalid token.

### `PUT /v1/files/<org>/<path>`

Uploads the raw ciphertext bytes for the path. Server does not parse or validate format beyond size + path checks.

- Requires a `write` scope matching `<org>/<path>`.
- Request body: ciphertext bytes, `application/octet-stream`. Max 256 KiB.
- Server writes to a temp path under `/data` then atomically renames into place.
- 204 on success.
- 413 if body exceeds size cap.
- 403/401 as above.

### `GET /v1/resolve/<org>/<path>?env=<env>`

Returns an ordered manifest of files the client should fetch to assemble a cascade, broad → specific. Used by the CLI's remote-cascade flow.

```json
{
  "files": [
    "acme/.env",
    "acme/payments/.env",
    "acme/payments/api/.env",
    "acme/payments/api/.env.prod"
  ]
}
```

Only files the requesting token has `read` scope for are returned. Files that do not exist are omitted (not 404).

### `GET /v1/health`

200 always. No auth. Returns `{ "ok": true, "version": "<sha>" }`.

### Admin routes

There are none. Org creation and token minting happen via the operator CLI on the server host. Rationale: keeps the over-the-wire surface free of god-mode routes that become CVE magnets.

## Operator CLI (server-side)

The same `pluto` binary that runs the server also acts as the operator tool. Operator subcommands talk directly to the SQLite store on disk; no HTTP roundtrip. Requires shell access to the server host.

```sh
pluto serve                                          # start the HTTP server
pluto org create acme                                # create a new org namespace
pluto token create --org acme \
                   --scope 'acme/payments/**:read' \
                   --scope 'acme/payments/api/staging:write' \
                   --label "ci-publish" \
                   --expires 30d                     # mint a token (prints plaintext once)
pluto token list --org acme
pluto token revoke <id>
```

## Client CLI (workspace-side)

The same `pluto` binary, run on a developer machine or in CI, provides client subcommands that talk to a remote pluto server over HTTP. These never touch the server's SQLite or filesystem directly.

```sh
pluto init                                # one-time: write pluto.config.json at workspace root
pluto pull                                # fetch + decrypt → write local .env.<type>
pluto pull --out .env.local               # explicit output path
pluto exec -- node app.js                 # fetch + decrypt → exec with env injected (no file on disk)
pluto push .env.prod                      # encrypt locally + upload (requires write scope)
pluto status                              # show resolved config + reachability check
```

### Required inputs

Every client subcommand needs four pieces of information:

| Field | What | Required |
|---|---|---|
| `token` | bearer token (`sk_xxx`) | yes |
| `org` | top-segment under which the request resolves | yes |
| `service` | path within the org (`payments/api`, may be multiple segments) | yes |
| `env` | environment / type (`dev`, `staging`, `prod`, …) | yes |

Plus `server` (the pluto HTTP endpoint). Together these compose the storage path: `<org>/<service>/.env.<env>`.

### Resolution order

For each required field, the CLI walks this chain and uses the first source that supplies a value:

1. **CLI flag** — `--token`, `--server`, `--org`, `--service`, `--env` (or `--type` as an alias).
2. **Environment variable** — `PLUTO_TOKEN`, `PLUTO_SERVER`, `PLUTO_ORG`, `PLUTO_SERVICE`, `PLUTO_ENV`.
3. **Config file** — `--config <path>` flag if given; otherwise discovery walk for `pluto.config.{ts,js,json}` or `.pluto.json` from cwd up to the workspace root (same walk envx uses). A Docker user can mount a file at any path and pass `--config /mnt/pluto.json`.
4. **Interactive prompt** — only if `process.stdin.isTTY`. Each missing field is prompted in order. `token` is read with masking.
5. **Error** — non-TTY and still missing → exit 2 with a descriptive message naming the field.

### Config file shape

```jsonc
// pluto.config.json (workspace root, safe to commit if no token)
{
  "server": "https://pluto.acme.internal",
  "org": "acme",
  "service": "payments/api",
  "env": "prod"
}
```

```ts
// pluto.config.ts — typed variant
import { defineConfig } from "@multiterm/pluto/client";
export default defineConfig({
  server: "https://pluto.acme.internal",
  org: "acme",
  service: "payments/api",
  env: "prod",
});
```

**Tokens never live in the committed config file.** They come from `PLUTO_TOKEN`, `--token`, or interactive prompt. The config schema rejects a `token` field with a load-time error to make this hard to get wrong by accident.

### `pluto init`

Interactive setup that prompts for `server`, `org`, `service`, `env`, then writes a `pluto.config.json` at the workspace root. Tests reachability with the supplied token (does not persist it). Idempotent — refuses to overwrite an existing config unless `--force`.

### Behavior: `pluto pull`

1. Resolve config.
2. `GET /v1/resolve/<org>/<service>?env=<env>` to get the cascade manifest.
3. `GET /v1/files/<org>/<file>` for each entry in order.
4. Locate the local `.env.keys` (same workspace walk envx uses).
5. Decrypt each file, merge later-wins.
6. Write to `--out` if given, else `.env.<env>` at cwd.

### Behavior: `pluto exec`

Steps 1–5 as `pluto pull`, but instead of writing a file, spawn the child command (everything after `--`) with the resolved env merged onto `process.env`. Decryption happens in-memory only; no plaintext touches disk.

### Behavior: `pluto push`

1. Read the local plaintext file passed as argument.
2. Fetch the per-service public key (cached locally; refreshed on cache miss).
3. Encrypt values with the public key, preserving comments and blank lines.
4. `PUT /v1/files/<org>/<service>/.env.<env>` with the resulting bytes.
5. Server returns 204 → exit 0. Anything else → exit 1 with the server's message.

### Behavior: `pluto status`

Prints the resolved config (token masked), the source each field came from (flag/env/file/prompt), and the result of `GET /v1/health` against the resolved server. Non-zero exit on reachability failure.

## Storage layout

```
/data/
├── pluto.db                       # SQLite: tokens, orgs, audit
└── envs/
    └── <org>/
        └── <team>/
            └── <service>/
                ├── .env
                ├── .env.prod
                └── .env.staging
```

One filesystem hierarchy mirrors the URL hierarchy. Backup is `tar /data`. When this gets painful (renames, soft delete, GDPR) we move to hash-flat with SQLite metadata — not now.

## SQLite schema

```sql
CREATE TABLE orgs (
  name        TEXT PRIMARY KEY,           -- matches path grammar
  created_at  INTEGER NOT NULL
);

CREATE TABLE tokens (
  id          TEXT PRIMARY KEY,           -- tok_<random>
  org         TEXT NOT NULL REFERENCES orgs(name) ON DELETE CASCADE,
  hash        TEXT NOT NULL,              -- argon2id of the plaintext
  scopes      TEXT NOT NULL,              -- JSON array of {path, access}
  label       TEXT NOT NULL DEFAULT '',
  created_at  INTEGER NOT NULL,
  expires_at  INTEGER,                    -- null = no expiry
  revoked_at  INTEGER                     -- null = active
);

CREATE INDEX tokens_org ON tokens(org);

CREATE TABLE audit (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ts          INTEGER NOT NULL,
  org         TEXT NOT NULL,
  token_id    TEXT,                       -- null for anonymous (health)
  action      TEXT NOT NULL,              -- 'get' | 'put' | 'deny' | 'auth_fail'
  path        TEXT NOT NULL,
  status      INTEGER NOT NULL,           -- HTTP status returned
  ip          TEXT
);

CREATE INDEX audit_org_ts ON audit(org, ts);
```

## Rate limits & quotas

Per-org token-bucket on requests, configurable per-org override in `config.yaml`:

```yaml
defaults:
  requests_per_minute: 600
  storage_bytes: 10485760     # 10 MiB
overrides:
  acme:
    requests_per_minute: 6000
```

Exceeding the rate limit returns 429 with `Retry-After`. Exceeding storage quota fails the `PUT` with 507.

## Out of scope for MVP

- Signed manifests (replay protection) — defer until a real consumer needs it.
- OIDC/SSO for admin operations — operator CLI on the host is enough for self-host MVP.
- S3-backed storage — filesystem is fine for the volume self-hosted teams will see.
- Cross-org operations — never, by design.

## Threat model summary

| Attacker | Capability | Mitigation |
|---|---|---|
| Network observer | TLS-protected by reverse proxy | Operator runs behind TLS-terminating proxy (nginx, Caddy, etc.) |
| Stolen read token | Fetch ciphertext within scope | Useless without matching `.env.keys` private key |
| Stolen write token | Upload bogus ciphertext to scope | Bounded by narrow write scope (one service/env); auditable |
| Server compromise | Read every ciphertext on disk + SQLite | Still no plaintext; rotate keys via `envx rotate` |
| Server compromise (active) | Serve attacker-controlled ciphertext | Client's `.env.keys` won't decrypt foreign-keypair ciphertext → loud failure. Replay of older legitimate file still possible — Phase 3 signed manifests close this. |
| Token mint with broad+write scopes | Privilege escalation | Rejected at mint time |
| Path traversal | Read outside org/scope | Single chokepoint normalizer rejects |
| Cross-tenant access | Read another org's files | Auth hook binds `req.org` to token; routes assert path-org match |
