#!/bin/sh
set -eu

# Runs only when PostgreSQL initializes an empty data directory. Passwords are
# supplied by the root-only compose env file and are never baked into the image.
: "${DOTLOCKER_PREVIEW_DB:=pluto_preview}"
: "${DOTLOCKER_PREVIEW_USER:=pluto_preview}"
: "${DOTLOCKER_PREVIEW_PASSWORD:?DOTLOCKER_PREVIEW_PASSWORD is required for first initialization}"
: "${DOTLOCKER_PRODUCTION_DB:=pluto_prod}"
: "${DOTLOCKER_PRODUCTION_USER:=pluto_prod}"
: "${DOTLOCKER_PRODUCTION_PASSWORD:?DOTLOCKER_PRODUCTION_PASSWORD is required for first initialization}"

create_role_and_database() {
  db=$1
  user=$2
  password=$3
  psql --username "$POSTGRES_USER" --dbname "$POSTGRES_DB" \
    --set=db="$db" --set=user="$user" --set=password="$password" <<'SQL'
SELECT format('CREATE ROLE %I LOGIN PASSWORD %L', :'user', :'password')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'user') \gexec
SELECT format('CREATE DATABASE %I OWNER %I', :'db', :'user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = :'db') \gexec
SQL
}

create_role_and_database "$DOTLOCKER_PREVIEW_DB" "$DOTLOCKER_PREVIEW_USER" "$DOTLOCKER_PREVIEW_PASSWORD"
create_role_and_database "$DOTLOCKER_PRODUCTION_DB" "$DOTLOCKER_PRODUCTION_USER" "$DOTLOCKER_PRODUCTION_PASSWORD"
