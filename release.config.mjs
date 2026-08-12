export default {
  versioning: 'independent',
  packages: ['packages/apps/cli'],
  branches: ['develop', 'main'],
  branchChannels: { develop: 'beta', main: 'latest' },
  prereleaseIds: { beta: 'b' },
  packageManager: 'pnpm',
  checks: ['pnpm build', 'pnpm --filter @multiterm/pluto-client test', 'pnpm --filter @multiterm/pluto-server test', 'pnpm --filter @multiterm/pluto test'],
  access: 'public',
  github: true,
};
