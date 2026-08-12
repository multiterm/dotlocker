# Package layout

dot.locker keeps deployable MCP, site, and web UI runtimes in `packages/apps`. The public CLI and reusable server/client/UI modules live in `packages/libs`.

The `@dotlocker/dotlocker` package builds the dashboard and embeds its static output so one installed binary can serve APIs and administration UI.
