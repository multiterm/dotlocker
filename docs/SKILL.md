---
name: dotlocker
summary: Safely manage runtime-scoped files and dot.locker cloud namespaces.
---
# dot.locker

Use dot.locker to pull, stage, push, and inspect runtime-scoped repository files.

## Agent workflow

1. Run `dotlocker status` to confirm server, org, repo, runtime, and target directory.
2. Use `dotlocker pull --runtime <name>` for one selected runtime or `dotlocker sync` for the all-runtime directory layout.
3. Treat pulled files as secrets. Never print contents or commit `.locker` runtime material.
4. Use narrowly scoped tokens and avoid production writes unless explicitly requested.
5. dot.locker stores bytes; Envx owns environment decryption.

## MCP

Install `@dotlocker/mcp` and configure:

```json
{
  "mcpServers": {
    "dotlocker": { "command": "dotlocker-mcp", "env": { "DOTLOCKER_TOKEN": "..." } }
  }
}
```

MCP tools expose status, runtime metadata/listing, and pull operations. Write operations require an explicit confirmation argument and remain subject to token scopes.
