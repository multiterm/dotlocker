#!/usr/bin/env node
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { PlutoClient, resolveClient } from '@dotlocker/dotlocker';
import { z } from 'zod';

const server = new McpServer({ name: 'pluto-mcp', version: '0.1.0' });
server.tool('pluto_status', 'Resolve Pluto configuration without returning its bearer token.', { cwd: z.string().optional(), config: z.string().optional(), runtime: z.string().optional() }, async ({ cwd, config, runtime }) => {
  const resolved = await resolveClient({ cwd: cwd ?? process.cwd(), flags: { config, runtime }, prompt: null });
  const { token: _token, ...safe } = resolved;
  return text(safe);
});
server.tool('pluto_runtime_files', 'List visible file metadata for a Pluto runtime. File contents are not returned.', { cwd: z.string().optional(), config: z.string().optional(), runtime: z.string().optional() }, async ({ cwd, config, runtime }) => {
  const resolved = await resolveClient({ cwd: cwd ?? process.cwd(), flags: { config, runtime }, prompt: null });
  const client = new PlutoClient({ server: resolved.server, token: resolved.token });
  const manifest = await client.resolve(resolved.org, resolved.repo, resolved.runtime);
  return text({ org: resolved.org, repo: resolved.repo, runtime: resolved.runtime, files: manifest.files });
});
function text(value: unknown) { return { content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] }; }
await server.connect(new StdioServerTransport());
