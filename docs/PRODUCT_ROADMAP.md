# dot.locker product and platform roadmap

This document captures the next architecture and dashboard work after content-addressed runtime versions. Priorities are ordered by correctness and operational risk, not visual impact.

## Current foundation

- Organization/repository/runtime scoped files and API keys.
- Organization-wide API keys using `<org>/**` read and write scopes.
- SHA-256 runtime trees with 64-character long hashes, 12-character short hashes, parent links, immutable manifests, and deduplicated blobs.
- Runtime history API and `dotlocker versions`.
- Staged content-addressed object uploads, atomic committed-head reads, and compare-and-swap pushes.
- Keyname-backed dashboard sessions, grants, audit records, and file metadata.

## P0 — correctness and recovery

### Atomic staged pushes — implemented

Objects upload without changing the visible runtime, the server validates the complete manifest, and commit atomically compare-and-swaps the runtime head. Pulls resolve through committed heads. Interrupted uploads remain unreachable and will be handled by garbage collection.

### Historical pull, checkout, and rollback

- `dotlocker pull --version <hash>` reads an immutable tree without changing its head.
- `dotlocker rollback <hash>` appends a new version whose tree matches the selected historical version.
- API endpoints resolve version manifests and versioned file bytes.
- Rollback never deletes history or moves a head backward invisibly.

### Optimistic concurrency — protocol implemented

Pushes include the parent hash observed before staging. If another writer moves the head, the server returns `409 DOTLOCKER_CONFLICT` with expected and current hashes. A future explicit `--expected-version` flag will support deployment policy and scripting use cases.

### Hash reference resolution

Accept full hashes and unique short prefixes. Require a safe minimum prefix, reject ambiguous references, and return canonical long and short hashes in every response.

## P1 — lifecycle and policy

### Object garbage collection and retention

Add mark-and-sweep GC over blobs, staged uploads, and immutable manifests. Support dry-run, grace periods, per-repository retention, “latest N,” and “younger than N days.” Never delete an object reachable from a head or retained tag.

### First-class key policies

Represent all repositories, selected repositories, all runtimes, and selected runtimes as structured policy in addition to compiled scopes. Add source/IP restrictions, expiration policy, and machine-readable policy explanations.

### Key rotation and hygiene

Provide overlap-based rotation, `lastUsedAt`, last source, stale-key warnings, non-expiring-key warnings, and one-click revoke after migration. Require explicit confirmation for organization-wide write keys and consider forbidding non-expiring global write keys.

### Commit metadata

Capture message, actor, dot.locker client version, source Git SHA, CI provider/job URL, and deployment metadata. Keep tree identity content-addressed while commit identity includes parent and metadata in a canonical format.

### Diff API and CLI

`dotlocker diff <a> <b>` reports added, modified, and deleted files using manifests without downloading bytes. The dashboard should render the same API.

### Tags, channels, and protected runtimes

Keep mutable runtime heads and add immutable tags. Protected runtimes can require an approval, signed source, or CI identity before head updates.

### Signed versions

Clients may sign canonical manifests. Store signer identity and signature, verify on pull/deploy, expose trust policy, and support key rotation. This provides tamper evidence even if storage is compromised.

## P1 — dashboard and automation

### Admin logs

Provide an organization-admin event stream for authentication, API-key lifecycle, grants, reads, writes, deletes, pushes, versions, settings, webhook delivery, and policy denials. Include filters, search, pagination, export, actor/source metadata, and old/new version hashes. Sensitive values and API-key plaintext must never be logged.

### Webhooks

Manage signed organization webhook endpoints from Settings. Initial events cover audit events and runtime versions. Production completion requires retries with exponential backoff, idempotent delivery IDs, replay, dead-letter handling, endpoint health, secret rotation, SSRF controls, delivery retention, and test delivery.

### Integrations

Provide a dedicated integrations catalog for GitHub Actions, GitLab CI, Kubernetes, Docker, Terraform, MCP, and generic webhooks. Integrations should compile to least-privilege API-key and webhook policies rather than becoming a parallel authorization system.

### Keypost-aligned dashboard system

Match the Keypost console structure: collapsible primary sidebar, grouped navigation, compact top toolbar, page-owned headers, fixed operational footer, and a secondary Settings sidebar. Reuse and extend dot.locker `gds`, `ui`, and `ui-shared` packages instead of creating route-local design primitives.

## P2 — scale and operations

### First-class repositories and runtimes

Add repository/runtime records for empty repositories, ownership, policy inheritance, deletion lifecycle, protected runtime configuration, default retention, and display metadata. Stop relying exclusively on inferred file paths.

### Quotas and limits

Enforce object size, manifest bytes, file count, versions, total reachable storage, webhook endpoints, and requests per organization/repository. Return explicit limit metadata and reject before committing.

### Observability

Expose metrics for push latency, compare-and-swap conflicts, deduplication ratio, reachable/orphaned bytes, GC, version counts, webhook latency/failures, auth failures, and rate limits. Add structured traces around push and delivery IDs.

## Delivery sequence

1. Dashboard shell, page headers, Settings sidebar, admin logs, webhook management, and integrations catalog.
2. Atomic staged push and optimistic concurrency.
3. Historical reads, rollback, hash resolution, and diffs.
4. Webhook retries/replay and expanded audit coverage.
5. Key policies/rotation and repository/runtime policy records.
6. GC, retention, quotas, signing, tags, and protected runtime approvals.

## Security requirements

- Preserve tenant isolation at every route and database query.
- Require organization-admin access for logs and webhook administration.
- Sign webhook payloads and never return signing secrets after creation/rotation.
- Validate outbound webhook destinations and protect private network metadata endpoints.
- Use compare-and-swap for runtime heads.
- Keep immutable objects and manifests append-only.
- Redact credentials, cookies, authorization headers, file bytes, and webhook secrets from logs.
