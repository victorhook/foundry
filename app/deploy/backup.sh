#!/usr/bin/env bash
# Consistent online backup of the Logbook SQLite DB (safe while the app runs).
# Uses SQLite's .backup, then prunes copies older than BACKUP_KEEP_DAYS.
set -euo pipefail

DB="${DATABASE_PATH:-/opt/logbook/data/logbook.db}"
DEST="${BACKUP_DIR:-/opt/logbook/backups}"
KEEP_DAYS="${BACKUP_KEEP_DAYS:-30}"

# Nothing to back up before the first run creates the DB — skip cleanly.
if [ ! -f "$DB" ]; then
	echo "no database at $DB yet — nothing to back up"
	exit 0
fi

mkdir -p "$DEST"
STAMP="$(date +%F_%H%M%S)"
OUT="$DEST/logbook-$STAMP.db"

sqlite3 "$DB" ".backup '$OUT'"
echo "backup written: $OUT"

# Prune old backups.
find "$DEST" -maxdepth 1 -name 'logbook-*.db' -type f -mtime "+$KEEP_DAYS" -print -delete
