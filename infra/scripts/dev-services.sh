#!/usr/bin/env bash
# Starts PostgreSQL 16 and Redis for local development and tests.
# Prefers Docker Compose; falls back to locally installed binaries when no
# Docker daemon is reachable (e.g. sandboxed CI or cloud dev containers).
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DATA="$ROOT/.data"
PG_PORT="${ARF_PG_PORT:-5432}"
REDIS_PORT="${ARF_REDIS_PORT:-6379}"
CMD="${1:-up}"

if docker info >/dev/null 2>&1; then
  case "$CMD" in
    up) docker compose -f "$ROOT/infra/docker/docker-compose.yml" up -d --wait ;;
    down) docker compose -f "$ROOT/infra/docker/docker-compose.yml" down ;;
  esac
  exit 0
fi

PG_BIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
[ -n "$PG_BIN" ] || PG_BIN="$(dirname "$(command -v initdb)")"

run_pg() {
  if [ "$(id -u)" = "0" ]; then
    chown -R postgres:postgres "$DATA/pg" "$DATA/pg-log" 2>/dev/null || true
    su postgres -s /bin/bash -c "$*"
  else
    bash -c "$*"
  fi
}

case "$CMD" in
  up)
    mkdir -p "$DATA/pg" "$DATA/pg-log" "$DATA/redis"
    if [ ! -f "$DATA/pg/PG_VERSION" ]; then
      run_pg "$PG_BIN/initdb -D '$DATA/pg' -U arf --auth=trust >/dev/null"
    fi
    if ! run_pg "$PG_BIN/pg_ctl -D '$DATA/pg' status" >/dev/null 2>&1; then
      run_pg "$PG_BIN/pg_ctl -D '$DATA/pg' -l '$DATA/pg-log/postgres.log' -o '-p $PG_PORT -k /tmp' -w start"
    fi
    run_pg "$PG_BIN/psql -h /tmp -p $PG_PORT -U arf -d postgres -tc \"SELECT 1 FROM pg_database WHERE datname='arf'\" | grep -q 1 || $PG_BIN/createdb -h /tmp -p $PG_PORT -U arf arf"
    if ! redis-cli -p "$REDIS_PORT" ping >/dev/null 2>&1; then
      redis-server --port "$REDIS_PORT" --dir "$DATA/redis" --daemonize yes --save "" --appendonly no >/dev/null
    fi
    echo "postgres://arf@127.0.0.1:$PG_PORT/arf"
    echo "redis://127.0.0.1:$REDIS_PORT"
    ;;
  down)
    run_pg "$PG_BIN/pg_ctl -D '$DATA/pg' -m fast stop" || true
    redis-cli -p "$REDIS_PORT" shutdown nosave >/dev/null 2>&1 || true
    ;;
  *) echo "usage: dev-services.sh up|down" >&2; exit 2 ;;
esac
