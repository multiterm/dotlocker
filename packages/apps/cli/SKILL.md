---
name: pluto
summary: Safely manage runtime-scoped files and Pluto cloud namespaces.
---
# Pluto

Use Pluto to pull, stage, push, and inspect runtime-scoped repository files.

## Agent workflow

1. Run `pluto status` to confirm server, org, repo, runtime, and target directory.
2. Use `pluto pull --runtime <name>` for one selected runtime or `pluto sync` for the all-runtime directory layout.
3. Treat pulled files as secrets. Never print contents or commit `.pluto` runtime material.
4. Use narrowly scoped tokens and avoid production writes unless explicitly requested.
5. Pluto stores bytes; Envx owns environment decryption.

## MCP

Install `@multiterm/pluto-mcp` and configure:

```json
{
  "mcpServers": {
    "pluto": { "command": "pluto-mcp", "env": { "PLUTO_TOKEN": "..." } }
  }
}
```

MCP tools expose status, runtime metadata/listing, and pull operations. Write operations require an explicit confirmation argument and remain subject to token scopes.
