#!/usr/bin/env bash
# Revert working-tree changes, rebuild, restart. Use when a feature breaks the build/site.
set -uo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin:/root/.nvm/versions/node/v24.5.0/bin
cd /www/DatingAgent || exit 1

echo "[rollback] discarding working tree changes"
git checkout -- . 2>/dev/null
git clean -fdq backend/src frontend/src docs 2>/dev/null

echo "[rollback] rebuilding last good commit"
if ! npm run build >/tmp/da-build.log 2>&1; then
  echo "[rollback] last commit does not build either — service left as-is"
  tail -30 /tmp/da-build.log
  exit 1
fi

pm2 restart dating-agent --update-env >/dev/null 2>&1
for i in $(seq 1 25); do
  code=$(curl -s -m 5 -o /dev/null -w '%{http_code}' http://127.0.0.1:3012/api/health || true)
  [ "$code" = "200" ] && { echo "[rollback] recovered, health 200"; exit 0; }
  sleep 1
done
echo "[rollback] health still failing after rollback"
exit 1
