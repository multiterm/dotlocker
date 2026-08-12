// #region -- Top-level package surface ---------------------

// Server-side (operator) surface.
export * from "@dotlocker/server";

// Client-side (workspace) surface — re-exported under the bare package import
// so that `import { defineConfig } from "@dotlocker/dotlocker"` works for users
// who don't want the subpath. The "@dotlocker/dotlocker/client" subpath is the
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
} from "@dotlocker/client";

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
} from "@dotlocker/client";

export * from "@dotlocker/shared";

// #endregion ------------------------------------------------
