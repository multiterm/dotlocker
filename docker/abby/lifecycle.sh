#!/usr/bin/env bash
set -Eeuo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
ENV_FILE=${DOTLOCKER_ABBY_ENV_FILE:-/vol/nvme/docker/pluto/abby.env}
INFRA_COMPOSE="$ROOT/docker/abby/compose.infrastructure.yml"
APP_COMPOSE="$ROOT/docker/abby/compose.application.yml"
BACKUP_ROOT=${DOTLOCKER_ABBY_BACKUP_ROOT:-/vol/nvme/docker/pluto/backups}

if [[ ! -r "$ENV_FILE" ]]; then
  echo "Missing readable Abby environment file: $ENV_FILE" >&2
  echo "Copy docker/abby/abby.env.example to that path, populate it, and chmod 600." >&2
  exit 2
fi
mode=$(stat -c '%a' "$ENV_FILE" 2>/dev/null || stat -f '%Lp' "$ENV_FILE")
if (( (8#$mode & 8#077) != 0 )); then
  echo "Refusing overly permissive environment file $ENV_FILE; run chmod 600." >&2
  exit 2
fi

if docker compose version >/dev/null 2>&1; then
  COMPOSE=(docker compose)
elif command -v docker-compose >/dev/null 2>&1; then
  COMPOSE=(docker-compose)
else
  echo "Docker Compose is required (docker compose or docker-compose)." >&2
  exit 2
fi
infra() { "${COMPOSE[@]}" --env-file "$ENV_FILE" -f "$INFRA_COMPOSE" "$@"; }
app() { "${COMPOSE[@]}" --env-file "$ENV_FILE" -f "$APP_COMPOSE" "$@"; }
wait_healthy() {
  local name=$1 attempts=${2:-60}
  for ((i=1; i<=attempts; i++)); do
    status=$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' "$name" 2>/dev/null || true)
    [[ "$status" == healthy ]] && return 0
    [[ "$status" == unhealthy || "$status" == exited ]] && { docker logs --tail 100 "$name" >&2 || true; return 1; }
    sleep 2
  done
  echo "$name did not become healthy" >&2
  return 1
}

command=${1:-help}
shift || true
case "$command" in
  validate)
    infra config --quiet
    app config --quiet
    ;;
  up)
    infra up -d --build --remove-orphans
    wait_healthy dotlocker-postgres
    wait_healthy dotlocker-garage
    ;;
  app-up)
    infra up -d
    app up -d --build --remove-orphans
    wait_healthy dotlocker-application
    ;;
  update)
    # Rebuild pinned images first; Compose only replaces containers after a successful build.
    infra build --pull
    infra up -d --remove-orphans
    wait_healthy dotlocker-postgres
    wait_healthy dotlocker-garage
    if docker inspect dotlocker-application >/dev/null 2>&1; then
      app build --pull
      app up -d --remove-orphans
      wait_healthy dotlocker-application
    fi
    ;;
  restart)
    infra restart "$@"
    ;;
  app-restart)
    app restart "$@"
    ;;
  status)
    infra ps
    app ps 2>/dev/null || true
    echo
    docker system df
    ;;
  logs)
    infra logs --tail 200 -f "$@"
    ;;
  app-logs)
    app logs --tail 200 -f "$@"
    ;;
  backup-postgres)
    mkdir -p "$BACKUP_ROOT"
    stamp=$(date -u +%Y%m%dT%H%M%SZ)
    target="$BACKUP_ROOT/postgres-$stamp.sql.gz"
    infra exec -T postgres sh -c 'pg_dumpall --clean --if-exists --username "$POSTGRES_USER"' | gzip -9 >"$target"
    chmod 600 "$target"
    gzip -t "$target"
    echo "$target"
    ;;
  prune)
    # Keep volumes and running containers. Only unreferenced images/build cache are removed.
    docker image prune -f
    docker builder prune -f --filter 'until=168h'
    ;;
  down-app)
    app down --remove-orphans
    ;;
  down)
    echo "Refusing to stop durable infrastructure without explicit confirmation." >&2
    [[ ${DOTLOCKER_CONFIRM_STOP_INFRA:-} == YES ]] || exit 2
    infra down --remove-orphans
    ;;
  *)
    cat <<'USAGE'
Usage: lifecycle.sh COMMAND
  validate         Validate both committed compose definitions
  up               Build/start PostgreSQL and Garage, then await health
  app-up            Build/start the optional Abby Dotlocker application
  update            Pull base images, rebuild, replace, and health-check
  restart [service] Restart infrastructure service(s)
  app-restart       Restart the optional application
  status            Show Compose state and Docker disk usage
  logs [service]    Follow infrastructure logs
  app-logs          Follow application logs
  backup-postgres   Write and verify a compressed logical cluster backup
  prune             Remove only unused images and week-old build cache
  down-app          Stop the optional application (volumes retained)
  down              Stop infrastructure only with DOTLOCKER_CONFIRM_STOP_INFRA=YES
USAGE
    ;;
esac
