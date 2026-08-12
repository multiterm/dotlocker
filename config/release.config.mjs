export default {
  versioning: 'independent',
  packages: ['packages/apps/mcp', 'packages/libs/cli'],
  branches: ['develop', 'main'],
  branchChannels: { develop: 'beta', main: 'latest' },
  prereleaseIds: { beta: 'b' },
  packageManager: 'pnpm',
  checks: ['rune build', 'rune test'],
  access: 'public',
  github: true,
};
