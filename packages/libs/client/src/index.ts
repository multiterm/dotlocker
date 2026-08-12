// #region -- Client public surface -------------------------

export {
  resolveClient,
  resolveFramework,
  discoverConfigFile,
  discoverLocalSecretFile,
  loadConfigFile,
  loadConfigFileAsync,
  loadLocalSecretFile,
  defineConfig,
  clientConfigSchema,
} from "./config.js";
export type {
  ClientConfig,
  LocalSecretConfig,
  ResolvedClient,
  ResolvedFramework,
  CliFlags,
  Source,
  ResolveOptions,
} from "./config.js";

export { PlutoClient } from "./http.js";
export type { ClientCredentials, ResolveResponse, LoginResponse } from "./http.js";

export { clientCommands } from "./cli.js";

// #endregion ------------------------------------------------
