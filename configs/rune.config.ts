import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Shared Rune config for the Dotlocker workspace. Use one repository-local
// cache even though filtered package commands execute from package directories.
const workspaceRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export default {
  cache: {
    directory: resolve(workspaceRoot, ".rune/cache"),
    namespace: "multiterm-dotlocker",
  },
  scripts: {
    build: [
      "tsc -p configs/tsconfig.build.json",
      "tsc-alias -p configs/tsconfig.build.json",
    ],
    dev: "tsc -p configs/tsconfig.build.json --watch",
    test: "vitest run --config configs/vitest.config.ts",
    "test:coverage": "vitest run --config configs/vitest.config.ts --coverage",
    typecheck: "tsc --noEmit",
    lint: "prettier --check src/",
    format: "prettier --write src/",
  },
};
