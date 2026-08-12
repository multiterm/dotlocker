# Sandblocks deployment

The root [`sandblocks.yml`](../sandblocks.yml) deploys Pluto as one isolated service, exposes `/v1/health`, and runs a post-deployment HTTP acceptance check. It follows the same version-2 manifest and managed-environment model used by Honeycluster Portal.

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

- `.sandblocks/environments/preview.env` to the `pluto / preview` managed environment.
- `.sandblocks/environments/production.env` to the `pluto / production` managed environment.

Use the Sandblocks dashboard/API environment editor for the configured project. Values are write-only managed deployment data and are injected into setup, build, service, and check phases without entering source bundles or image layers.

At minimum, Pluto needs `NODE_ENV`, `HOST`, `PORT`, `PLUTO_DATA_DIR`, and a durable `PLUTO_DATABASE_URL`. Add authentication, Keyname, webhook, and integration variables required by your installation to the local file before upload.

## Abby PostgreSQL layout

Pluto uses the existing PostgreSQL 16 service on Abby rather than creating a database inside a Sandblocks sandbox:

- Tailnet endpoint: `100.114.99.85:54329`.
- Physical cluster data: `/vol/nvme/docker/pluto/postgres`.
- Preview database/login: `pluto_preview`.
- Production database/login: `pluto_prod`.
- Root-only credential source on Abby: `/vol/nvme/docker/pluto/runtime-databases.env`.

PostgreSQL owns the physical directory and stores databases in internal OID paths, so preview and production are isolated as separate databases and roles—not manually managed subfolders. Do not rename or edit anything below the PostgreSQL data directory.

The local ignored files `.sandblocks/environments/preview.env` and `.sandblocks/environments/production.env` contain the corresponding connection URLs and are the source files to upload to Sandblocks. The existing legacy `pluto` database and `/vol/nvme/docker/pluto/data/pluto.db*` SQLite files are not used by the new Sandblocks runtimes.

## Register and deploy

```sh
pnpm sandblocks:validate
pnpm sandblocks:doctor
pnpm sandblocks:register
pnpm sandblocks:preview
pnpm sandblocks:status
```

For production:

```sh
pnpm sandblocks:production
SANDBLOCKS_ENVIRONMENT=production pnpm sandblocks:status
```

Redeploy or destroy the selected environment with:

```sh
SANDBLOCKS_ENVIRONMENT=preview pnpm sandblocks:redeploy
SANDBLOCKS_ENVIRONMENT=preview pnpm sandblocks:destroy
```

## Persistence

Sandblocks service filesystems are replaceable. PostgreSQL metadata is durable on Abby through `PLUTO_DATABASE_URL`; uploaded runtime file bytes still use `PLUTO_DATA_DIR`. Do not depend on `/data` surviving sandbox replacement unless the target Sandblocks project explicitly attaches durable storage. Configure durable Sandblocks storage for `/data` before treating either runtime as production-ready.
