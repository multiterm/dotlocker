# Pluto development deployment

Pluto development runs on the Stratus host rather than a local or legacy development webserver.

```bash
bun run deploy:dev
# or
pnpm exec rune deploy-dev-stratus
```

The workflow runs workspace checks, synchronizes source to `/opt/pluto`, builds the image remotely, starts an isolated `pluto-dev` Docker Compose project, and verifies `http://127.0.0.1:5175/v1/health`.

Useful options:

```bash
node scripts/workflow/deploy-dev.mjs --dry-run --skip-checks
node scripts/workflow/deploy-dev.mjs --action sync
node scripts/workflow/deploy-dev.mjs --action restart --skip-checks --skip-build
```

Defaults:

| Setting | Value |
| --- | --- |
| SSH host | `ansible@100.78.201.50` |
| SSH key | `~/.ssh/ansible-honey` |
| Remote root | `/opt/pluto` |
| Host port | `5175` |
| Compose project | `pluto-dev` |

Override host settings with `PLUTO_STRATUS_HOST`, `PLUTO_STRATUS_SSH_KEY`, and `PLUTO_STRATUS_ROOT` or the equivalent command flags. The remote `.env.dev` is mode `0600`; its PostgreSQL password is generated on first deployment and preserved by later syncs.

The public Pangolin resource `pluto.honeycluster.xyz` targets Stratus at `100.78.201.50:5175` with Pangolin SSO disabled because Pluto enforces its own Keyname sessions and bearer-token API authorization.
