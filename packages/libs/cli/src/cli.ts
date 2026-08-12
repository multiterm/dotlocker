// #region -- dotlocker unified CLI entry ------------------

import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { operatorCommands } from "@dotlocker/server";
import { clientCommands } from "@dotlocker/client";
import { PlutoError } from "@dotlocker/shared";

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
      process.stderr.write(`error [${err.code}]: ${err.message}\n`);
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
