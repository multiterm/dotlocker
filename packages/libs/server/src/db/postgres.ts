// #region -- Drizzle/Postgres connection -------------------

import postgres from "postgres";
import { drizzle, type PostgresJsDatabase } from "drizzle-orm/postgres-js";
import * as schema from "./schema.js";
import { migratePostgres } from "./postgres-migrate.js";

export type PgDB = PostgresJsDatabase<typeof schema>;

export interface OpenPostgresOptions {
  readonly url?: string;
  readonly max?: number;
}

export async function openPostgresDb(
  options: OpenPostgresOptions = {},
): Promise<{ db: PgDB; client: postgres.Sql }> {
  const url = options.url ?? process.env.DOTLOCKER_DATABASE_URL ?? process.env.PLUTO_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url)
    throw new Error(
      "PLUTO_DATABASE_URL or DATABASE_URL is required for Postgres-backed Pluto auth",
    );
  const client = postgres(url, { max: options.max ?? 10 });
  await migratePostgres(client);
  return { db: drizzle(client, { schema }), client };
}

// #endregion ------------------------------------------------
