# Package layout

Pluto keeps deployable MCP, site, and web UI runtimes in `packages/apps`. The public CLI and reusable server/client/UI modules live in `packages/libs`.

The `@multiterm/pluto` package builds the dashboard and embeds its static output so one installed binary can serve APIs and administration UI.
