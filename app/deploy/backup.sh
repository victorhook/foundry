#!/usr/bin/env bash
# Consistent online backup of the Logbook SQLite DB (safe while the app runs).
# Uses SQLite's .backup, then prunes copies older than BACKUP_KEEP_DAYS.
set -euo pipefail

DB="${DATABASE_PATH:-/opt/logbook/data/logbook.db}"
DEST="${BACKUP_DIR:-/opt/logbook/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

mkdir -p "$DEST"
STAMP="$(date +%F_%H%M%S)"
OUT="$DEST/logbook-$STAMP.db"

sqlite3 "$DB" ".backup '$OUT'"
echo "backup written: $OUT"

# Prune old backups.
find "$DEST" -maxdepth 1 -name 'logbook-*.db' -type f -mtime "+$KEEP_DAYS" -print -delete
