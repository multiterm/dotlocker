// #region -- Operator CLI subcommands ----------------------

import { join } from "node:path";
import { mkdirSync } from "node:fs";
import type { Argv, CommandModule } from "yargs";
import { openDb } from "./db.js";
import { FileStore } from "./files.js";
import { buildServer } from "./http.js";
import { createOrg, listOrgs, mintToken, listTokens, revokeToken } from "./tokens.js";
import type { Access, TokenScope } from "@multiterm/pluto-shared";
import { PlutoError } from "@multiterm/pluto-shared";
import { createUser, listUsers, verifyUserEmail } from "./users.js";
import { listServices, upsertService } from "./services.js";
import {
  grantOrgAdmin,
  grantRepo,
  grantRuntime,
  listOrgGrants,
  listUserGrants,
  revokeGrant,
  type GrantAccess,
} from "./grants.js";

interface ServerCommonArgs {
  readonly data: string;
}

const dataDirOption = {
  alias: "d",
  type: "string" as const,
  describe: "Pluto data directory (DB + ciphertext files)",
  default: process.env.PLUTO_DATA_DIR ?? "/data",
};

// #region -- pluto serve ----------------------------------

interface ServeArgs extends ServerCommonArgs {
  readonly port: number;
  readonly host: string;
}

const serveCommand: CommandModule<unknown, ServeArgs> = {
  command: "serve",
  describe: "Start the Pluto HTTP server",
  builder: (yargs: Argv) =>
    yargs
      .option("data", dataDirOption)
      .option("port", {
        alias: "p",
        type: "number",
        default: Number(process.env.PORT ?? 3000),
      })
      .option("host", {
        type: "string",
        default: process.env.HOST ?? "0.0.0.0",
      }) as Argv<ServeArgs>,
  handler: async (args) => {
    mkdirSync(args.data, { recursive: true });
    const db = openDb(join(args.data, "pluto.db"));
    const store = new FileStore({ root: join(args.data, "files") });
    const app = await buildServer({ db, store, logger: true });
    await app.listen({ port: args.port, host: args.host });
    // Fastify logs the listening line itself when logger=true.
  },
};

// #endregion --------------------------------------------

// #region -- pluto org -----------------------------------

const orgCommand: CommandModule<unknown, ServerCommonArgs> = {
  command: "org <action>",
  describe: "Manage orgs",
  builder: (yargs: Argv) =>
    yargs
      .option("data", dataDirOption)
      .command<ServerCommonArgs & { readonly name: string }>(
        "create <name>",
        "Create a new org",
        (y) =>
          y.positional("name", {
            describe: "Org name (lowercase, dash-allowed)",
            type: "string",
            demandOption: true,
          }),
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          createOrg(db, args.name);
          process.stdout.write(`created org '${args.name}'\n`);
        },
      )
      .command<ServerCommonArgs>(
        "list",
        "List orgs",
        (y) => y,
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          for (const name of listOrgs(db)) {
            process.stdout.write(`${name}\n`);
          }
        },
      )
      .demandCommand(1) as Argv<ServerCommonArgs>,
  handler: () => {
    // routed by subcommand builder
  },
};

// #endregion --------------------------------------------

// #region -- pluto user ---------------------------------

interface UserCreateArgs extends ServerCommonArgs {
  readonly email: string;
  readonly password: string;
  readonly verified?: boolean;
}

const userCommand: CommandModule<unknown, ServerCommonArgs> = {
  command: "user <action>",
  describe: "Manage users (emails only)",
  builder: (yargs: Argv) =>
    yargs
      .option("data", dataDirOption)
      .command<UserCreateArgs>(
        "create <email>",
        "Create a user with an email username",
        (y) =>
          y
            .positional("email", { type: "string", demandOption: true })
            .option("password", { type: "string", demandOption: true })
            .option("verified", { type: "boolean", default: false }),
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          const user = createUser(db, {
            email: args.email,
            password: args.password,
            verified: args.verified ?? false,
          });
          process.stdout.write(`${user.email}\tverified=${user.verifiedAt !== null}\n`);
        },
      )
      .command<ServerCommonArgs & { readonly email: string }>(
        "verify <email>",
        "Mark a user's email as verified",
        (y) => y.positional("email", { type: "string", demandOption: true }),
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          const user = verifyUserEmail(db, args.email);
          process.stdout.write(`${user.email}\tverified=true\n`);
        },
      )
      .command<ServerCommonArgs>(
        "list",
        "List users",
        (y) => y,
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          for (const user of listUsers(db)) {
            process.stdout.write(`${user.email}\tverified=${user.verifiedAt !== null}\n`);
          }
        },
      )
      .demandCommand(1) as Argv<ServerCommonArgs>,
  handler: () => {
    // routed by subcommand builder
  },
};

// #endregion --------------------------------------------

// #region -- pluto service ------------------------------

interface ServiceUpsertArgs extends ServerCommonArgs {
  readonly org: string;
  readonly name: string;
  readonly owner?: string;
  readonly allow?: readonly string[];
}

const serviceCommand: CommandModule<unknown, ServerCommonArgs> = {
  command: "service <action>",
  describe: "Manage services and source-warning allowlists",
  builder: (yargs: Argv) =>
    yargs
      .option("data", dataDirOption)
      .command<ServiceUpsertArgs>(
        "upsert <name>",
        "Create or update a service",
        (y) =>
          y
            .positional("name", { type: "string", demandOption: true })
            .option("org", { type: "string", demandOption: true })
            .option("owner", { type: "string", describe: "Owner email" })
            .option("allow", {
              type: "string",
              array: true,
              describe: "Allowed source IP, CIDR, or region:<code>. Repeatable.",
            }),
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          const service = upsertService(db, {
            org: args.org,
            name: args.name,
            ownerEmail: args.owner ?? null,
            allowedSources: args.allow ?? [],
          });
          process.stdout.write(
            `${service.org}/${service.name}\towner=${service.ownerEmail ?? "-"}\tallow=${service.allowedSources.join(",")}\n`,
          );
        },
      )
      .command<ServerCommonArgs & { readonly org: string }>(
        "list",
        "List services for an org",
        (y) => y.option("org", { type: "string", demandOption: true }),
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          for (const service of listServices(db, args.org)) {
            process.stdout.write(
              `${service.org}/${service.name}\towner=${service.ownerEmail ?? "-"}\tallow=${service.allowedSources.join(",")}\n`,
            );
          }
        },
      )
      .demandCommand(1) as Argv<ServerCommonArgs>,
  handler: () => {
    // routed by subcommand builder
  },
};

// #endregion --------------------------------------------

// #region -- pluto token --------------------------------

interface TokenCreateArgs extends ServerCommonArgs {
  readonly org: string;
  readonly scope: readonly string[];
  readonly label?: string;
  readonly expires?: string;
  readonly user?: string;
  readonly service?: string;
}

const tokenCommand: CommandModule<unknown, ServerCommonArgs> = {
  command: "token <action>",
  describe: "Manage tokens",
  builder: (yargs: Argv) =>
    yargs
      .option("data", dataDirOption)
      .command<TokenCreateArgs>(
        "create",
        "Mint a new token (plaintext printed once)",
        (y) =>
          y
            .option("org", { type: "string", demandOption: true })
            .option("scope", {
              type: "string",
              array: true,
              demandOption: true,
              describe: "Scope as '<path>:<read|write>'. Repeatable. e.g. 'acme/payments/**:read'",
            })
            .option("label", { type: "string" })
            .option("expires", {
              type: "string",
              describe: "Duration like '30d', '24h', '1y' or 'never' (default never)",
            })
            .option("user", {
              type: "string",
              describe: "Verified owner email for this token",
            })
            .option("service", {
              type: "string",
              describe: "Registered service this token is for, e.g. portal/api-server",
            }),
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          const scopes = args.scope.map(parseScopeArg);
          const { plaintext } = mintToken(db, {
            org: args.org,
            scopes,
            label: args.label ?? "",
            expiresAt: parseExpiry(args.expires),
            userEmail: args.user ?? null,
            service: args.service ?? null,
          });
          process.stdout.write(`${plaintext}\n`);
          process.stderr.write("(this is the only time the token is shown — store it now)\n");
        },
      )
      .command<ServerCommonArgs & { readonly org: string }>(
        "list",
        "List tokens for an org",
        (y) => y.option("org", { type: "string", demandOption: true }),
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          for (const t of listTokens(db, args.org)) {
            const status = t.revokedAt
              ? "revoked"
              : t.expiresAt && t.expiresAt <= Date.now()
                ? "expired"
                : "active";
            process.stdout.write(
              `${t.id}\t${status}\t${t.service ?? "-"}\t${t.userEmail ?? "-"}\t${t.label || "(no label)"}\n`,
            );
          }
        },
      )
      .command<ServerCommonArgs & { readonly id: string }>(
        "revoke <id>",
        "Revoke a token",
        (y) =>
          y.positional("id", {
            type: "string",
            describe: "Token id",
            demandOption: true,
          }),
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          revokeToken(db, args.id);
          process.stdout.write(`revoked '${args.id}'\n`);
        },
      )
      .demandCommand(1) as Argv<ServerCommonArgs>,
  handler: () => {
    // routed by subcommand builder
  },
};

// #endregion --------------------------------------------

const grantCommand: CommandModule<unknown, ServerCommonArgs> = {
  command: "grant <action>",
  describe: "Manage user grants",
  builder: (yargs: Argv) =>
    yargs
      .option("data", dataDirOption)
      .command<ServerCommonArgs & { readonly email: string; readonly org: string }>(
        "org-admin <email>",
        "Grant org-admin access",
        (y) =>
          y
            .positional("email", { type: "string", demandOption: true })
            .option("org", { type: "string", demandOption: true }),
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          const grant = grantOrgAdmin(db, args.email, args.org);
          process.stdout.write(`${grant.email}\t${grant.org}\torg_admin\n`);
        },
      )
      .command<
        ServerCommonArgs & {
          readonly email: string;
          readonly org: string;
          readonly repo: string;
          readonly access: GrantAccess;
        }
      >(
        "repo <email>",
        "Grant repo access",
        (y) =>
          y
            .positional("email", { type: "string", demandOption: true })
            .option("org", { type: "string", demandOption: true })
            .option("repo", { type: "string", demandOption: true })
            .option("access", {
              type: "string",
              choices: ["read", "write", "admin"] as const,
              demandOption: true,
            }),
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          const grant = grantRepo(db, {
            email: args.email,
            org: args.org,
            repo: args.repo,
            access: args.access,
          });
          process.stdout.write(`${grant.email}\t${grant.org}/${grant.repo}\t${grant.access}\n`);
        },
      )
      .command<
        ServerCommonArgs & {
          readonly email: string;
          readonly org: string;
          readonly repo: string;
          readonly runtime: string;
          readonly access: GrantAccess;
        }
      >(
        "runtime <email>",
        "Grant runtime access",
        (y) =>
          y
            .positional("email", { type: "string", demandOption: true })
            .option("org", { type: "string", demandOption: true })
            .option("repo", { type: "string", demandOption: true })
            .option("runtime", { type: "string", demandOption: true })
            .option("access", {
              type: "string",
              choices: ["read", "write", "admin"] as const,
              demandOption: true,
            }),
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          const grant = grantRuntime(db, {
            email: args.email,
            org: args.org,
            repo: args.repo,
            runtime: args.runtime,
            access: args.access,
          });
          process.stdout.write(
            `${grant.email}\t${grant.org}/${grant.repo}/${grant.runtime}\t${grant.access}\n`,
          );
        },
      )
      .command<ServerCommonArgs & { readonly email?: string; readonly org?: string }>(
        "list [email]",
        "List grants for a user or org",
        (y) =>
          y
            .positional("email", { type: "string" })
            .option("org", { type: "string", demandOption: true }),
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          const grants = args.email
            ? listUserGrants(db, args.email, args.org)
            : listOrgGrants(db, args.org!);
          for (const g of grants)
            process.stdout.write(
              `${g.kind}\t${g.email}\t${g.org}\t${g.repo ?? "-"}\t${g.runtime ?? "-"}\t${g.access}\n`,
            );
        },
      )
      .command<
        ServerCommonArgs & {
          readonly email: string;
          readonly org: string;
          readonly repo?: string;
          readonly runtime?: string;
        }
      >(
        "revoke <email>",
        "Revoke an org/repo/runtime grant",
        (y) =>
          y
            .positional("email", { type: "string", demandOption: true })
            .option("org", { type: "string", demandOption: true })
            .option("repo", { type: "string" })
            .option("runtime", { type: "string" }),
        (args) => {
          const db = openDb(join(args.data, "pluto.db"));
          revokeGrant(db, {
            email: args.email,
            org: args.org,
            repo: args.repo ?? null,
            runtime: args.runtime ?? null,
          });
          process.stdout.write(`revoked grant for ${args.email}\n`);
        },
      )
      .demandCommand(1) as Argv<ServerCommonArgs>,
  handler: () => {},
};

export const operatorCommands: ReadonlyArray<CommandModule<unknown, never>> = [
  serveCommand as unknown as CommandModule<unknown, never>,
  orgCommand as unknown as CommandModule<unknown, never>,
  userCommand as unknown as CommandModule<unknown, never>,
  serviceCommand as unknown as CommandModule<unknown, never>,
  tokenCommand as unknown as CommandModule<unknown, never>,
  grantCommand as unknown as CommandModule<unknown, never>,
];

function parseScopeArg(raw: string): TokenScope {
  const idx = raw.lastIndexOf(":");
  if (idx === -1) {
    throw new PlutoError(
      "PLUTO_INVALID_SCOPE",
      `scope must be '<path>:<read|write>' (got '${raw}')`,
      0,
    );
  }
  const path = raw.slice(0, idx);
  const access = raw.slice(idx + 1) as Access;
  if (access !== "read" && access !== "write") {
    throw new PlutoError(
      "PLUTO_INVALID_SCOPE",
      `access must be 'read' or 'write' (got '${access}')`,
      0,
    );
  }
  return { path, access };
}

function parseExpiry(s: string | undefined): number | null {
  if (!s || s === "never") return null;
  const m = /^(\d+)([smhdy])$/.exec(s);
  if (!m) {
    throw new PlutoError(
      "PLUTO_CONFIG_INVALID",
      `expires must match like '30d', '24h', '1y' (got '${s}')`,
      0,
    );
  }
  const n = Number(m[1]);
  const unit = m[2];
  const ms =
    unit === "s"
      ? 1000
      : unit === "m"
        ? 60_000
        : unit === "h"
          ? 3_600_000
          : unit === "d"
            ? 86_400_000
            : 31_536_000_000; // y
  return Date.now() + n * ms;
}

// #endregion ------------------------------------------------
