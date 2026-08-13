# syntax=docker/dockerfile:1.7
ARG NODE_VERSION=22-bookworm-slim

FROM node:${NODE_VERSION} AS build

ENV PNPM_HOME=/pnpm \
    PATH=/pnpm:$PATH \
    CI=true
WORKDIR /workspace

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates g++ make python3 \
 && rm -rf /var/lib/apt/lists/* \
 && corepack enable \
 && corepack prepare pnpm@11.4.0 --activate

COPY pnpm-lock.yaml pnpm-workspace.yaml package.json ./
COPY packages/apps/mcp/package.json packages/apps/mcp/package.json
COPY packages/apps/site/package.json packages/apps/site/package.json
COPY packages/apps/webui/package.json packages/apps/webui/package.json
COPY packages/libs/cli/package.json packages/libs/cli/package.json
COPY packages/libs/client/package.json packages/libs/client/package.json
COPY packages/libs/gds/package.json packages/libs/gds/package.json
COPY packages/libs/server/package.json packages/libs/server/package.json
COPY packages/libs/shared/package.json packages/libs/shared/package.json
COPY packages/libs/ui/package.json packages/libs/ui/package.json
COPY packages/libs/ui-shared/package.json packages/libs/ui-shared/package.json

RUN --mount=type=cache,id=dotlocker-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile --ignore-scripts

COPY . .
RUN --mount=type=cache,id=dotlocker-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile \
 && pnpm build \
 && pnpm --filter @dotlocker/dotlocker deploy --prod --legacy /opt/dotlocker \
 && cd /opt/dotlocker \
 && pnpm rebuild better-sqlite3

FROM node:${NODE_VERSION} AS runtime

LABEL org.opencontainers.image.title="dot.locker" \
      org.opencontainers.image.description="Self-hosted runtime-scoped encrypted file delivery" \
      org.opencontainers.image.source="https://github.com/multiterm/dotlocker"

RUN apt-get update \
 && apt-get install -y --no-install-recommends ca-certificates tini \
 && rm -rf /var/lib/apt/lists/* \
 && groupadd --system --gid 1001 dotlocker \
 && useradd --system --uid 1001 --gid dotlocker --home /home/dotlocker --create-home dotlocker

WORKDIR /opt/dotlocker
COPY --from=build --chown=dotlocker:dotlocker /opt/dotlocker ./

RUN mkdir -p /data \
 && chown dotlocker:dotlocker /data

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    DOTLOCKER_DATA_DIR=/data

VOLUME ["/data"]
EXPOSE 3000
USER dotlocker

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD ["node", "-e", "fetch('http://127.0.0.1:3000/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]

ENTRYPOINT ["/usr/bin/tini", "--", "node", "/opt/dotlocker/dist/cli.js"]
CMD ["serve"]
