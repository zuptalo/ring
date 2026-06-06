#!/usr/bin/env bash
# Self-contained dev-server watchdog for ring-client.
# Starts Vite on :5199 and restarts it whenever it stops responding.
# Logs to /tmp/vite-ringclient.log (server) and /tmp/vite-watchdog.log (this).
set -u

DIR="/Users/kamran/Desktop/ring-client"
PORT=5173
SRV_LOG="/tmp/vite-ringclient.log"
WD_LOG="/tmp/vite-watchdog.log"

ts() { date '+%Y-%m-%d %H:%M:%S'; }
log() { echo "[$(ts)] $*" >> "$WD_LOG"; }

start_vite() {
  cd "$DIR" || { log "FATAL: cannot cd to $DIR"; exit 1; }
  nohup npx vite --port "$PORT" >> "$SRV_LOG" 2>&1 &
  echo $! > /tmp/vite-ringclient.pid
  log "started vite (pid $(cat /tmp/vite-ringclient.pid))"
}

healthy() {
  local code
  code=$(curl -s -o /dev/null -m 5 -w "%{http_code}" "http://localhost:$PORT/" 2>/dev/null)
  [ "$code" = "200" ]
}

log "watchdog up; ensuring server on :$PORT"
if ! healthy; then start_vite; fi

# Give it a moment to boot, then verify.
sleep 5
if healthy; then log "server healthy (HTTP 200)"; else log "server NOT healthy after initial start"; fi

while true; do
  sleep 30
  if ! healthy; then
    log "PROBLEM: health check failed (no HTTP 200). Restarting."
    # kill any stale vite on our port
    pkill -f "vite --port $PORT" 2>/dev/null
    sleep 2
    start_vite
    sleep 5
    if healthy; then log "restart OK (HTTP 200)"; else log "restart attempted; still not healthy"; fi
  fi
done
