# syntax=docker/dockerfile:1.7
ARG POSTGRES_VERSION=16.8-alpine
FROM postgres:${POSTGRES_VERSION}

LABEL org.opencontainers.image.title="Dotlocker PostgreSQL"
LABEL org.opencontainers.image.description="PostgreSQL runtime for Dotlocker metadata and immutable versions"

COPY --chmod=0555 initdb/10-dotlocker-databases.sh /docker-entrypoint-initdb.d/10-dotlocker-databases.sh
