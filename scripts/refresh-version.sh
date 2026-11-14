#!/usr/bin/env bash
# F16 — after the loop commits, make /api/version report the NEW head commit.
#
# The backend resolves its sha at process start (backend/src/lib/git-sha.ts), so
# a restart is all that is needed: no rebuild, no working-tree changes.
# Exit 0 only when /api/version.gitSha == `git rev-parse --short HEAD`.
set -uo pipefail
export PATH=/usr/local/bin:/usr/bin:/bin:/root/.nvm/versions/node/v24.5.0/bin
cd /www/DatingAgent || exit 1

head_sha=$(git rev-parse --short HEAD) || { echo "[refresh-version] not a git checkout"; exit 1; }

if [ -n "$(git status --porcelain)" ]; then
  echo "[refresh-version] working tree dirty — commit first, refusing to restart"
  exit 1
fi

pm2 restart dating-agent --update-env >/tmp/da-pm2.log 2>&1 || {
  echo "[refresh-version] pm2 restart failed"
  cat /tmp/da-pm2.log
  exit 1
}

code=000
for _ in $(seq 1 25); do
  code=$(curl -s -m 5 -o /tmp/da-version.json -w '%{http_code}' http://127.0.0.1:3012/api/version || true)
  [ "$code" = "200" ] && break
  sleep 1
done

if [ "$code" != "200" ]; then
  echo "[refresh-version] /api/version http ${code}"
  exit 1
fi

api_sha=$(sed -n 's/.*"gitSha":"\([^"]*\)".*/\1/p' /tmp/da-version.json)

if [ "$api_sha" = "$head_sha" ]; then
  echo "[refresh-version] ok: /api/version gitSha=${api_sha} == HEAD ${head_sha}"
  exit 0
fi

echo "[refresh-version] MISMATCH: /api/version gitSha='${api_sha}' != HEAD '${head_sha}'"
exit 1
