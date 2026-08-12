# Sandblocks deployment

The root [`sandblocks.yml`](../sandblocks.yml) deploys dot.locker as one isolated service, exposes `/v1/health`, and runs a post-deployment HTTP acceptance check. It follows the same version-2 manifest and managed-environment model used by Honeycluster Portal.

## Local client configuration

Sandblocks credentials and environment source files are local-only. Create them from the committed templates:

```sh
mkdir -p .sandblocks/environments
cp examples/sandblocks/config.env.example .sandblocks/config.env
cp examples/sandblocks/environments/preview.env.example .sandblocks/environments/preview.env
cp examples/sandblocks/environments/production.env.example .sandblocks/environments/production.env
chmod 600 .sandblocks/config.env .sandblocks/environments/*.env
```

The entire `.sandblocks/` directory is gitignored. Do not move real values into `sandblocks.yml`, `.env.example`, Docker build arguments, or committed scripts.

Load the local client credentials before running the CLI:

```sh
set -a
. .sandblocks/config.env
set +a
```

## Upload managed environments

The manifest intentionally contains no secret names, values, provider references, or env-file paths. Sandblocks resolves one opaque managed environment by project and environment identity.

Upload the complete contents of:

- `.sandblocks/environments/preview.env` to the `dotlocker / preview` managed environment.
- `.sandblocks/environments/production.env` to the `dotlocker / production` managed environment.

Use the Sandblocks dashboard/API environment editor for the configured project. Values are write-only managed deployment data and are injected into setup, build, service, and check phases without entering source bundles or image layers.

At minimum, dot.locker needs `NODE_ENV`, `HOST`, `PORT`, `DOTLOCKER_DATA_DIR`, and a durable `DOTLOCKER_DATABASE_URL`. Add authentication, Keyname, webhook, and integration variables required by your installation to the local file before upload.

## Abby PostgreSQL layout

dot.locker uses the existing PostgreSQL 16 service on Abby rather than creating a database inside a Sandblocks sandbox:

- Tailnet endpoint: `100.114.99.85:54329`.
- Physical cluster data (legacy host path): `/vol/nvme/docker/pluto/postgres`.
- Preview database/login: `pluto_preview`.
- Production database/login: `pluto_prod`.
- Root-only credential source on Abby: `/vol/nvme/docker/pluto/runtime-databases.env`.

PostgreSQL owns the physical directory and stores databases in internal OID paths, so preview and production are isolated as separate databases and roles—not manually managed subfolders. Do not rename or edit anything below the PostgreSQL data directory.

The local ignored files `.sandblocks/environments/preview.env` and `.sandblocks/environments/production.env` contain the corresponding connection URLs and are the source files to upload to Sandblocks.

The preview was initialized from a transactionally consistent online backup of the legacy Abby SQLite database and its encrypted `data/files` objects. `scripts/workflow/sandblocks-start.mjs` supports this one-time initialization through the write-only `DOTLOCKER_BOOTSTRAP_ARCHIVE_URL` managed environment value when its local data directory is empty. Remove that managed value and stop the temporary archive server immediately after a successful deployment. The current legacy Abby Pluto app and original `/vol/nvme/docker/pluto/data/pluto.db*` files remain untouched.

## Register and deploy

```sh
pnpm sandblocks:validate
pnpm sandblocks:doctor
pnpm sandblocks:register
pnpm sandblocks:preview
pnpm sandblocks:status
```

For production, deployment and promotion are separate operations. A successful deployment remains available only at its immutable candidate URL until a releaser explicitly promotes it. Promotion atomically points both `dotlocker.dev` and `dotlocker.sh` at that revision:

```sh
pnpm sandblocks:production
SANDBLOCKS_ENVIRONMENT=production pnpm sandblocks:status
sandblocks sandbox promote --project "$SANDBLOCKS_PROJECT_ID" --sandbox <sandbox-id>
```

Use the immutable candidate URL from `status` for final browser and health verification before promotion. Preview deployments have no stable alias; neither production domain moves merely because checks pass.

Redeploy or destroy the selected environment with:

```sh
SANDBLOCKS_ENVIRONMENT=preview pnpm sandblocks:redeploy
SANDBLOCKS_ENVIRONMENT=preview pnpm sandblocks:destroy
```

## Persistence

Sandblocks service filesystems are replaceable. PostgreSQL authentication metadata is durable on Abby through `DOTLOCKER_DATABASE_URL`; current dot.locker file metadata/version operations and uploaded runtime bytes still use the bootstrapped local SQLite database and `DOTLOCKER_DATA_DIR`. Preview currently uses `/tmp/dotlocker-data` because the constrained service cannot create `/data`. Configure durable Sandblocks storage and complete dot.locker's PostgreSQL file-metadata migration before treating either runtime as production-ready.
