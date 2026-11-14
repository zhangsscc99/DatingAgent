#!/usr/bin/env bash
# Build → restart → health-check DatingAgent. Exit 0 only if the site is serving.
# Never run this before `npm run build` passes; it is the gate for the cron feature loop.
set -uo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin:/root/.nvm/versions/node/v24.5.0/bin
cd /www/DatingAgent || exit 1

echo "[ci-deploy] build"
if ! npm run build >/tmp/da-build.log 2>&1; then
  echo "[ci-deploy] BUILD FAILED — see /tmp/da-build.log"
  tail -30 /tmp/da-build.log
  exit 1
fi
echo "[ci-deploy] build ok"

pm2 restart dating-agent --update-env >/tmp/da-pm2.log 2>&1 || { echo "[ci-deploy] pm2 restart failed"; cat /tmp/da-pm2.log; exit 1; }

for i in $(seq 1 25); do
  code=$(curl -s -m 5 -o /tmp/da-health.json -w '%{http_code}' http://127.0.0.1:3012/api/health || true)
  [ "$code" = "200" ] && break
  sleep 1
done

if [ "${code:-000}" != "200" ]; then
  echo "[ci-deploy] HEALTH FAILED (http ${code:-000})"
  cat /tmp/da-health.json 2>/dev/null; echo
  pm2 logs dating-agent --lines 20 --nostream 2>/dev/null | tail -25
  exit 1
fi

echo "[ci-deploy] health: $(cat /tmp/da-health.json)"

# Smoke test: one real chat round-trip through the agent harness.
if [ "${DA_SKIP_SMOKE:-0}" != "1" ]; then
  out=$(curl -s -m 90 -o /tmp/da-smoke.json -w '%{http_code}' http://127.0.0.1:3012/api/chat \
    -H 'Content-Type: application/json' \
    -d '{"message":"Smoke test: reply with the single word OK."}' || true)
  if [ "$out" != "200" ]; then
    echo "[ci-deploy] SMOKE FAILED (http ${out:-000})"
    head -c 400 /tmp/da-smoke.json 2>/dev/null; echo
    exit 1
  fi
  echo "[ci-deploy] smoke: $(head -c 300 /tmp/da-smoke.json)"
fi

echo "[ci-deploy] OK"
