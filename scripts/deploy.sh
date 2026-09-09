#!/bin/bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

PORT="${PORT:-3001}"
PREVIEW_PORT="${PREVIEW_PORT:-3000}"
LOG_DIR="${LOG_DIR:-/var/log}"
PID_DIR="${PID_DIR:-/var/run/dating-agent}"
BACKEND_PID_FILE="$PID_DIR/backend.pid"
FRONTEND_PID_FILE="$PID_DIR/frontend.pid"
BACKEND_LOG="$LOG_DIR/dating-agent.log"
FRONTEND_LOG="$LOG_DIR/dating-agent-frontend.log"

port_in_use() {
  local port="$1"
  if command -v ss &>/dev/null; then
    ss -tln | grep -q ":${port} "
  elif command -v lsof &>/dev/null; then
    lsof -i ":${port}" -sTCP:LISTEN -t &>/dev/null
  else
    return 1
  fi
}

stop_pid_file() {
  local pid_file="$1"
  local label="$2"
  if [[ -f "$pid_file" ]]; then
    local pid
    pid="$(cat "$pid_file")"
    if kill -0 "$pid" 2>/dev/null; then
      echo "Stopping $label (PID $pid)..."
      kill "$pid" 2>/dev/null || true
      sleep 1
      kill -9 "$pid" 2>/dev/null || true
    fi
    rm -f "$pid_file"
  fi
}

wait_for_port_free() {
  local port="$1"
  local tries=0
  while port_in_use "$port" && [[ $tries -lt 10 ]]; do
    sleep 1
    tries=$((tries + 1))
  done
  if port_in_use "$port"; then
    echo "ERROR: Port $port is still in use. Stop the process or set PORT/PREVIEW_PORT."
    exit 1
  fi
}

echo "=== DatingAgent Deploy ==="

mkdir -p "$PID_DIR" "$LOG_DIR"

# Load env if present
if [[ -f "$ROOT/.env" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "$ROOT/.env"
  set +a
  echo "Loaded $ROOT/.env"
fi

PORT="${PORT:-3001}"
PREVIEW_PORT="${PREVIEW_PORT:-3000}"

echo "Install & build..."
npm install
npm run build

echo "Stopping previous processes..."
stop_pid_file "$BACKEND_PID_FILE" "backend"
stop_pid_file "$FRONTEND_PID_FILE" "frontend preview"
pkill -f "dating-agent-backend" 2>/dev/null || true
pkill -f "node dist/index.js" 2>/dev/null || true
sleep 1

echo "Checking ports ($PORT backend, $PREVIEW_PORT preview)..."
wait_for_port_free "$PORT"
wait_for_port_free "$PREVIEW_PORT"

echo "Starting backend on port $PORT..."
cd "$ROOT/backend"
nohup node dist/index.js >> "$BACKEND_LOG" 2>&1 &
echo $! > "$BACKEND_PID_FILE"
echo "Backend PID: $(cat "$BACKEND_PID_FILE") → $BACKEND_LOG"

echo "Starting frontend preview on port $PREVIEW_PORT..."
cd "$ROOT/frontend"
nohup npm run preview -- --host 0.0.0.0 --port "$PREVIEW_PORT" >> "$FRONTEND_LOG" 2>&1 &
echo $! > "$FRONTEND_PID_FILE"
echo "Frontend PID: $(cat "$FRONTEND_PID_FILE") → $FRONTEND_LOG"

if command -v ufw &>/dev/null; then
  ufw allow "$PREVIEW_PORT"/tcp comment 'DatingAgent frontend' 2>/dev/null || true
  ufw allow "$PORT"/tcp comment 'DatingAgent backend' 2>/dev/null || true
  ufw --force enable 2>/dev/null || true
  echo "Firewall: ports $PREVIEW_PORT, $PORT opened"
fi

HOST_IP="$(hostname -I 2>/dev/null | awk '{print $1}' || echo '127.0.0.1')"

echo ""
echo "Waiting for health check..."
for i in $(seq 1 15); do
  if curl -sf "http://127.0.0.1:${PORT}/api/health" >/dev/null; then
    echo "Health OK"
    curl -s "http://127.0.0.1:${PORT}/api/health" | head -c 500
    echo ""
    break
  fi
  if [[ $i -eq 15 ]]; then
    echo "WARNING: Health check did not pass within 15s — see $BACKEND_LOG"
  fi
  sleep 1
done

echo ""
echo "=== Deployed ==="
echo "Frontend: http://${HOST_IP}:${PREVIEW_PORT}"
echo "Backend:  http://${HOST_IP}:${PORT}"
echo "Health:   http://${HOST_IP}:${PORT}/api/health"
echo ""
echo "Log rotation hint:"
echo "  sudo cp scripts/dating-agent.logrotate /etc/logrotate.d/dating-agent"
echo "  Or use systemd journald instead of file logs (see README)."
