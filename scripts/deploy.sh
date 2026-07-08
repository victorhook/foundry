#!/usr/bin/env bash
# Release to production:
#   1. refuse if the working tree is dirty
#   2. run the test gate (unit + build)
#   3. build the production bundle
#   4. rsync it to the VPS and install prod deps
#   5. restart the systemd service
#   6. tag the release in git (and push the tag if a remote exists)
#
# Config comes from .deploy.env (copy .deploy.env.example). Nothing here is
# specific to one machine.
set -euo pipefail

cd "$(dirname "$0")/.."   # repo root

if [ ! -f .deploy.env ]; then
	echo "✗ Missing .deploy.env — copy .deploy.env.example and fill it in."
	exit 1
fi
set -a
# shellcheck disable=SC1091
source .deploy.env
set +a
: "${DEPLOY_HOST:?set DEPLOY_HOST in .deploy.env}"
: "${DEPLOY_USER:?set DEPLOY_USER in .deploy.env}"
: "${DEPLOY_PATH:?set DEPLOY_PATH in .deploy.env}"
SSH_TARGET="$DEPLOY_USER@$DEPLOY_HOST"
SERVICE="${DEPLOY_SERVICE:-logbook}"

# 1. Clean tree — deploy only what's committed.
if [ -n "$(git status --porcelain)" ]; then
	echo "✗ Working tree is not clean. Commit or stash first."
	git status --short
	exit 1
fi
REV="$(git rev-parse --short HEAD)"

# 2. Test gate (skip with SKIP_TESTS=1 in an emergency).
if [ "${SKIP_TESTS:-0}" != "1" ]; then
	echo "▶ Running test gate…"
	( cd app && npm run test:unit && npm run build )
else
	echo "⚠ SKIP_TESTS=1 — skipping tests"
	( cd app && npm run build )
fi

# 3. Ship.
echo "▶ Shipping build to $SSH_TARGET:$DEPLOY_PATH …"
rsync -az --delete -e ssh app/build "$SSH_TARGET:$DEPLOY_PATH/"
rsync -az -e ssh app/package.json app/package-lock.json app/deploy app/scripts "$SSH_TARGET:$DEPLOY_PATH/"

# 4 + 5. Back up the DB (pre-migration snapshot), install prod deps, restart.
echo "▶ Backing up DB, installing deps, restarting '$SERVICE' …"
ssh "$SSH_TARGET" "cd '$DEPLOY_PATH' && bash deploy/backup.sh && npm ci --omit=dev && sudo systemctl restart '$SERVICE'"

# 6. Tag the release.
TAG="release-$(date +%Y%m%d-%H%M%S)"
git tag -a "$TAG" -m "Release $TAG ($REV)"
if git remote | grep -q .; then
	git push --tags
fi

echo "✓ Deployed $REV as $TAG → $SSH_TARGET:$DEPLOY_PATH"
