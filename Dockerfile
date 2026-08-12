# syntax=docker/dockerfile:1.7
#
# @multiterm/pluto — built from this standalone monorepo.
#
#   docker build -t super-repo/pluto:dev .
#
# Multi-stage:
#   - build: pnpm install + `pnpm -r build` (builds libs, webui, then the cli
#     app which bundles the libs and copies webui assets into dist/webui), then
#     `pnpm deploy --prod` materializes a self-contained slice for the cli app.
#   - runtime: minimal node image carrying the deployed slice, runs as a
#     non-root user with a /data volume.

# -----------------------------------------------------------------------------
# Stage 1: build
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS build

WORKDIR /workspace

# Toolchain needed for better-sqlite3's native build.
RUN apt-get update \
 && apt-get install -y --no-install-recommends python3 make g++ ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable && corepack prepare pnpm@11.4.0 --activate

COPY . .

RUN pnpm install --frozen-lockfile
RUN pnpm -r build

# Materialize a self-contained deployable slice for the cli app: dist (cli +
# bundled libs + webui assets) + resolved production node_modules. Rebuild
# better-sqlite3 so its native binary is present in the slice.
RUN pnpm --filter @multiterm/pluto deploy --prod --legacy /opt/pluto-deploy \
 && cd /opt/pluto-deploy \
 && pnpm rebuild better-sqlite3

# -----------------------------------------------------------------------------
# Stage 2: runtime
# -----------------------------------------------------------------------------
FROM node:22-bookworm-slim AS runtime

RUN groupadd --system --gid 1001 pluto \
 && useradd --system --uid 1001 --gid pluto --home /home/pluto --create-home pluto

WORKDIR /opt/pluto

COPY --from=build /opt/pluto-deploy ./

# Data volume — SQLite (when used) + local state live here. Owned by the pluto
# user so the process can write to it.
RUN mkdir -p /data && chown -R pluto:pluto /data /opt/pluto
VOLUME ["/data"]

USER pluto

ENV PLUTO_DATA_DIR=/data \
    PORT=3000 \
    HOST=0.0.0.0 \
    NODE_ENV=production

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+process.env.PORT+'/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

ENTRYPOINT ["node", "/opt/pluto/dist/cli.js"]
CMD ["serve"]
