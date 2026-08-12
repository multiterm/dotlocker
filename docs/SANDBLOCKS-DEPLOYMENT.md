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

Sandblocks service filesystems are replaceable. Configure PostgreSQL through `PLUTO_DATABASE_URL` and use a project-managed durable database. Do not depend on `/data` surviving sandbox replacement unless the target Sandblocks project explicitly attaches durable storage.
