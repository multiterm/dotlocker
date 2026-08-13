export default {
  versioning: "independent",
  packages: ["packages/apps/mcp", "packages/libs/cli"],
  branches: ["develop", "main"],
  branchChannels: { develop: "beta", main: "latest" },
  prereleaseIds: { beta: "b" },
  packageManager: "pnpm",
  checks: ["pnpm exec rune build", "pnpm exec rune test"],
  access: "public",
  github: true,
  postCommit: {
    enabled: true,
    branches: ["develop"],
    background: true,
  },
};
