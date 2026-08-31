#!/bin/bash
set -e
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

echo "=== DatingAgent Deploy ==="

# Install & build
npm install
npm run build

# Stop existing processes
pkill -f "dating-agent-backend" 2>/dev/null || true
pkill -f "node dist/index.js" 2>/dev/null || true
sleep 1

# Start backend (serves API + frontend static)
cd backend
nohup node dist/index.js > /var/log/dating-agent.log 2>&1 &
echo "Backend PID: $!"

# Start frontend preview server (dev-style access on port 3000)
cd ../frontend
nohup npm run preview > /var/log/dating-agent-frontend.log 2>&1 &
echo "Frontend PID: $!"

# Open firewall ports
if command -v ufw &>/dev/null; then
  ufw allow 3000/tcp comment 'DatingAgent frontend' 2>/dev/null || true
  ufw allow 3001/tcp comment 'DatingAgent backend' 2>/dev/null || true
  ufw --force enable 2>/dev/null || true
  echo "Firewall: ports 3000, 3001 opened"
fi

echo ""
echo "=== Deployed ==="
echo "Frontend: http://$(hostname -I | awk '{print $1}'):3000"
echo "Backend:  http://$(hostname -I | awk '{print $1}'):3001"
echo "Health:   http://$(hostname -I | awk '{print $1}'):3001/api/health"
