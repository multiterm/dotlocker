# Dotlocker usability implementation

This plan turns Dotlocker into an approachable runtime configuration workspace while preserving its security model: Keyname authenticates humans, PostgreSQL authorizes and versions metadata, Garage stores encrypted objects, and Sandblocks deploys immutable candidates.

## Delivery order

### 1. Identity and onboarding

- Replace legacy `PLUTO_*` UI errors with structured `DOTLOCKER_*` errors.
- Explain unauthenticated, unprovisioned, forbidden, and expired-session states.
- Add access-request guidance and retain the last organization/runtime safely.
- Expose session identity, expiry, and logout controls.

Acceptance: a failed login always presents a human-readable action and never displays a raw legacy code.

### 2. File workspace

- Add repository/runtime/path breadcrumbs, runtime safety badges, sorting, search, and favorites.
- Add drag-and-drop and multi-file upload with progress.
- Add download, copy, rename, bulk selection, and delete.
- Add a safe text editor with syntax hints, masking, validation, and save diff.

Acceptance: users can discover, inspect, edit, upload, download, and organize files without using the CLI.

### 3. Versions, snapshots, and comparisons

- Expose immutable runtime versions and current head.
- Compare runtime snapshots and individual file content.
- Restore a historical snapshot and clone a snapshot to another runtime.
- Attach human labels and release notes.

Acceptance: production-affecting configuration changes are reviewable and reversible.

### 4. Access and credentials

- Add a visual permission matrix and “why access is allowed” explanations.
- Add temporary grants, role presets, scoped API keys, rotation, and expiration warnings.
- Expose active sessions and service identities.

Acceptance: administrators can understand and modify access without constructing scope strings manually.

### 5. Activity, notifications, and overview

- Add overview metrics for files, runtimes, storage, identities, tokens, and recent activity.
- Improve audit filtering/export and webhook delivery troubleshooting.
- Add notification events for production changes, access changes, expiring keys, and integrity failures.

Acceptance: operators can answer what changed, who changed it, and whether integrations delivered the event.

### 6. Storage and transfer operations

- Expose Garage connectivity, bucket/object counts, bytes, integrity checks, and orphan detection.
- Add checksum verification, upload queues, retries, and conflict detection.
- Add backup/restore status and safe garbage-collection previews.

Acceptance: storage drift and failed transfers are visible before they cause missing files.

### 7. Sandblocks release linkage

- Record the Dotlocker runtime snapshot used by a Sandblocks deployment.
- Compare candidate configuration with the live snapshot.
- Gate promotion on an immutable snapshot and retain rollback linkage.

Acceptance: application and configuration releases can be reviewed and rolled back as one unit.

### 8. CLI/dashboard continuity

- Use the same structured errors and terminology in API, CLI, and dashboard.
- Add “open in dashboard,” copyable CLI commands, device-oriented login guidance, and upload progress.

Acceptance: switching between CLI and dashboard does not require relearning concepts or credentials.

## Safety constraints

- Production mutations require explicit confirmation.
- Secret values are never returned in metadata, audit, or storage diagnostics.
- Browser previews are bounded text-only reads; binary objects download instead.
- Runtime snapshots are immutable; restore creates a new snapshot.
- Garage credentials remain write-only Sandblocks managed values.
- Deployment remains candidate-first and promotion remains explicit.
