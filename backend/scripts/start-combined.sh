#!/bin/sh
set -eu

export PORT="${PORT:-10000}"
export ML_INTERNAL_PORT="${ML_INTERNAL_PORT:-7001}"
export BIOMETRIC_SERVICE_URL="${BIOMETRIC_SERVICE_URL:-http://127.0.0.1:${ML_INTERNAL_PORT}}"
export REDIS_URL="${REDIS_URL:-redis://127.0.0.1:6379/0}"

redis_pid=""
ml_pid=""
node_pid=""

shutdown() {
  trap - INT TERM EXIT
  for pid in "$node_pid" "$ml_pid" "$redis_pid"; do
    if [ -n "$pid" ]; then
      kill "$pid" 2>/dev/null || true
    fi
  done
  wait 2>/dev/null || true
}

trap shutdown INT TERM EXIT

redis-server --bind 127.0.0.1 --port 6379 --save "" --appendonly no &
redis_pid=$!

uvicorn app.main:app \
  --host 127.0.0.1 \
  --port "$ML_INTERNAL_PORT" \
  --proxy-headers \
  --forwarded-allow-ips="127.0.0.1" &
ml_pid=$!

attempt=0
until python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:${ML_INTERNAL_PORT}/api/health', timeout=3)" >/dev/null 2>&1; do
  if ! kill -0 "$ml_pid" 2>/dev/null; then
    echo "FastAPI ML service stopped during startup" >&2
    exit 1
  fi
  attempt=$((attempt + 1))
  if [ "$attempt" -ge 60 ]; then
    echo "FastAPI ML service did not become ready in time" >&2
    exit 1
  fi
  sleep 2
done

node src/server.js &
node_pid=$!

while kill -0 "$redis_pid" 2>/dev/null \
  && kill -0 "$ml_pid" 2>/dev/null \
  && kill -0 "$node_pid" 2>/dev/null; do
  sleep 5
done

echo "A process in the combined backend stopped unexpectedly" >&2
exit 1
