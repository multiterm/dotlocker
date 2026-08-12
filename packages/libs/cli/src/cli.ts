// #region -- dotlocker unified CLI entry ------------------

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { operatorCommands } from "@dotlocker/server";
import { clientCommands } from "@dotlocker/client";
import { PlutoError } from "@dotlocker/shared";

const actions: Record<string, string> = {
  PLUTO_NOT_FOUND:
    "Check the organization/repository/runtime path or ask an administrator to provision your identity.",
  PLUTO_FORBIDDEN: "Request a read or write grant for this path.",
  PLUTO_UNAUTHORIZED: "Set DOTLOCKER_TOKEN to an active scoped API key.",
  PLUTO_TOKEN_EXPIRED: "Rotate the API key and update DOTLOCKER_TOKEN.",
  PLUTO_TOKEN_REVOKED: "Create a replacement API key and update DOTLOCKER_TOKEN.",
  PLUTO_OBJECT_HASH_MISMATCH: "Retry the transfer; the invalid object was not accepted.",
};
function displayCode(code: string): string {
  return code.replace(/^PLUTO_/, "DOTLOCKER_");
}

async function main(): Promise<void> {
  let parser = yargs(hideBin(process.argv))
    .scriptName("dotlocker")
    .usage("$0 <command> [options]")
    .strict()
    .demandCommand(1, "")
    .help()
    .alias("help", "h")
    .version()
    .alias("version", "V");

  for (const cmd of operatorCommands) parser = parser.command(cmd);
  for (const cmd of clientCommands) parser = parser.command(cmd);

  parser = parser.epilogue(
    [
      "Server-side (run on the host):  serve, org, token",
      "Workspace-side (client):        init, pull, exec, push, status",
    ].join("\n"),
  );

  try {
    await parser.parseAsync();
  } catch (err: unknown) {
    if (err instanceof PlutoError) {
      process.stderr.write(`error [${displayCode(err.code)}]: ${err.message}\n`);
      const action = actions[err.code];
      if (action) process.stderr.write(`next: ${action}\n`);
      process.exit(1);
    }
    throw err;
  }
}

main().catch((err) => {
  process.stderr.write(`fatal: ${(err as Error).stack ?? String(err)}\n`);
  process.exit(1);
});

// #endregion ------------------------------------------------
