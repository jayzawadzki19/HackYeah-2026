#!/bin/sh
set -eu

if [ "${1:-}" = "login" ]; then
  exec uv run --project /app/connector connector login
fi

wait_for_open_wearables() {
  url="${OW_BASE_URL%/}/docs"
  echo "Waiting for open-wearables at ${url}"
  attempt=0
  while [ "$attempt" -lt 60 ]; do
    if URL="$url" bun -e 'const response = await fetch(process.env.URL); if (!response.ok) process.exit(1)' >/dev/null 2>&1; then
      return 0
    fi
    attempt=$((attempt + 1))
    sleep 3
  done
  echo "open-wearables did not become ready." >&2
  exit 1
}

stop() {
  nginx -c /etc/headroom/nginx.conf -s quit 2>/dev/null || true
  if [ -n "${connector_pid:-}" ]; then
    kill "$connector_pid" 2>/dev/null || true
  fi
  if [ -n "${api_pid:-}" ]; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  exit 0
}

mkdir -p /var/lib/headroom /tmp/nginx-client /tmp/nginx-proxy /tmp/nginx-fastcgi /tmp/nginx-uwsgi /tmp/nginx-scgi /app/api/data/local
touch /var/lib/headroom/api.env /var/lib/headroom/connector.env
ln -sfn /var/lib/headroom/api.env /app/api/.env.local
ln -sfn /var/lib/headroom/connector.env /app/connector/.env

wait_for_open_wearables

cd /app/api
bun scripts/setup-open-wearables.ts

if [ ! -f /var/lib/headroom/persona.ok ]; then
  bun scripts/generate-persona.ts --seed 2026 --today 2026-10-04
  touch /var/lib/headroom/persona.ok
fi

export WEB_ORIGIN="${WEB_ORIGIN:-http://localhost:4200}"
export CONNECTOR_URL="${CONNECTOR_URL:-http://127.0.0.1:8787}"
export DB_PATH="${DB_PATH:-/var/lib/headroom/headroom.sqlite}"
export PORT=3001
export GARMIN_TOKEN_DIR="${GARMIN_TOKEN_DIR:-/root/.garminconnect}"

nginx -c /etc/headroom/nginx.conf

if [ -d "$GARMIN_TOKEN_DIR" ] && [ -n "$(ls -A "$GARMIN_TOKEN_DIR" 2>/dev/null)" ]; then
  uv run --project /app/connector connector serve &
  connector_pid=$!
else
  echo "No Garmin session yet. Log in with: docker compose run --rm -it headroom login"
  echo "Then restart this container so the connector starts."
fi

trap stop TERM INT
bun src/main.ts &
api_pid=$!
wait "$api_pid"
