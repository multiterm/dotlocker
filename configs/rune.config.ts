// Shared rune config for the pluto workspace. Each package references this via
// `rune.extends` in its package.json and overrides `build` with its own vite
// invocation. Workspace-wide orchestration is `pnpm -r <script>` (topological).

export default {
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
