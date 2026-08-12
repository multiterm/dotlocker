// #region -- Top-level package surface ---------------------

// Server-side (operator) surface.
export * from "@multiterm/pluto-server";

// Client-side (workspace) surface — re-exported under the bare package import
// so that `import { defineConfig } from "@multiterm/pluto"` works for users
// who don't want the subpath. The "@multiterm/pluto/client" subpath is the
// preferred form for client code; this re-export keeps single-import setups
// frictionless.
export {
  PlutoClient,
  defineConfig,
  resolveClient,
  resolveFramework,
  loadConfigFile,
  discoverConfigFile,
  clientConfigSchema,
} from "@multiterm/pluto-client";

export type {
  ClientConfig,
  ResolvedClient,
  ResolvedFramework,
  CliFlags,
  Source,
  ResolveOptions,
  ClientCredentials,
  ResolveResponse,
  LoginResponse,
} from "@multiterm/pluto-client";

export * from "@multiterm/pluto-shared";

// #endregion ------------------------------------------------
