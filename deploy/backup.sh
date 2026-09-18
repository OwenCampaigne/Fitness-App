#!/usr/bin/env bash
# ── Database backup ───────────────────────────────────────────────────────────
# prisma/dev.db is gitignored, correctly — which means it exists in exactly one
# place. Every day of HRV, every logged set, every clearance record is in that
# one file. Cron this:
#   0 3 * * * /home/owen/fitness-app/deploy/backup.sh
set -euo pipefail

cd "$(dirname "$0")/.."
DB="prisma/dev.db"
DEST="${BACKUP_DIR:-$HOME/fitness-backups}"
KEEP=30

[ -f "$DB" ] || { echo "no database at $DB — nothing to back up"; exit 0; }
mkdir -p "$DEST"

STAMP=$(date +%Y-%m-%d-%H%M)
OUT="$DEST/dev-$STAMP.db"

# .backup, not cp: it takes a consistent snapshot even while the app is mid-write.
sqlite3 "$DB" ".backup '$OUT'"
gzip -f "$OUT"

# Keep the last N, drop the rest.
ls -1t "$DEST"/dev-*.db.gz 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm --

echo "✓ $OUT.gz  ($(ls -1 "$DEST"/dev-*.db.gz | wc -l) kept)"
