# Workspace lifecycle

This repository uses pnpm workspaces directly for dependency installation, package filtering, and lifecycle orchestration. Nx metadata and executors are not used.

```sh
pnpm install
pnpm build
pnpm test
pnpm typecheck   # when provided
pnpm release:dry
```

Use `pnpm --filter <package> …` for one package and `pnpm -r --if-present <script>` when adding a lifecycle shared by every package. `pnpm-workspace.yaml` is the source of truth for package discovery.
