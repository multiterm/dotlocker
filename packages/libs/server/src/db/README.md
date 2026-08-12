# Pluto DB layer

Pluto currently runs production auth and metadata through the legacy SQLite adapter exported from `src/server/db.ts`.

The target auth architecture is Postgres + Drizzle:

- `schema.ts` defines the Postgres tables, including `auth_tokens` and `refresh_tokens`.
- `postgres.ts` creates a Drizzle client from `PLUTO_DATABASE_URL` or `DATABASE_URL`.

Migration plan:

1. Keep filesystem blobs on disk.
2. Move users, grants, auth tokens, refresh tokens, file metadata, services, and audit to Postgres.
3. Replace the current `tokens` session table with `auth_tokens` + `refresh_tokens`.
4. Use HttpOnly cookies for browser auth and bearer tokens for CLI/agents.
5. Keep path authorization grant-based and always evaluated from Postgres.

Current runtime behavior is still SQLite until the server repositories are swapped to Drizzle-backed implementations.
