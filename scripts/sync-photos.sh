#!/usr/bin/env bash
# Pull the server's photo uploads down to this computer (one-way mirror).
# Photos aren't in the DB backup by choice; run this whenever you want a local copy.
#
#   ./scripts/sync-photos.sh [destination]     (or: make sync-photos)
#
# Destination defaults to ./photo-backup (gitignored). Override via arg or
# PHOTO_SYNC_DIR. Uses the VPS details from .deploy.env.
set -euo pipefail
cd "$(dirname "$0")/.."

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
DEPLOY_PATH="${DEPLOY_PATH:-/opt/foundry}"

DEST="${1:-${PHOTO_SYNC_DIR:-./photo-backup}}"
SRC="$DEPLOY_USER@$DEPLOY_HOST:$DEPLOY_PATH/data/uploads/"

mkdir -p "$DEST"
echo "▶ Syncing $SRC → $DEST"
# -a preserve, -z compress, --progress feedback. No --delete: never removes local
# copies even if a photo is later deleted on the server (safer local archive).
rsync -az --progress -e ssh "$SRC" "$DEST/"
echo "✓ Done — $(find "$DEST" -type f 2>/dev/null | wc -l | tr -d ' ') photos in $DEST"
