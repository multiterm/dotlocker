# Migrating from Pluto to dot.locker

Pluto is now **dot.locker**. Existing server data and HTTP API paths remain compatible; client naming changes are additive for one migration cycle.

| Legacy | Canonical |
| --- | --- |
| `@multiterm/pluto` | `@dotlocker/dotlocker` |
| `@multiterm/pluto-mcp` | `@dotlocker/mcp` |
| `pluto` | `dotlocker` |
| `.pluto/` | `.locker/` |
| `pluto.config.*` | `dotlocker.config.*` |
| `.pluto.local.json` | `.locker.local.json` |
| `PLUTO_*` | `DOTLOCKER_*` |
| `pluto-details.json` | `locker-details.json` |

## Safe local migration

```sh
pnpm remove @multiterm/pluto
pnpm add -D @dotlocker/dotlocker
mv .pluto .locker
mv config/pluto.config.ts config/dotlocker.config.ts
```

Update imports to `@dotlocker/dotlocker/client`, commands to `dotlocker`, and environment variables to `DOTLOCKER_*`.

The package still ships a `pluto` executable alias, reads `PLUTO_*`, discovers legacy config files, and reads `.pluto` when it is a local secret file. These fallbacks are temporary. `.locker` is always the canonical default and takes precedence.

Do not rename remote organization/repository/runtime paths or stored file records; they are data identities, not product branding.
