#!/usr/bin/env bash
# ── Pull, migrate, build, restart ─────────────────────────────────────────────
# Run on the Pi after pushing changes from the laptop:  ./deploy/deploy.sh
set -euo pipefail

cd "$(dirname "$0")/.."

echo "→ backing up the database first"
./deploy/backup.sh

echo "→ pulling"
git pull --ff-only

echo "→ installing (exact lockfile versions)"
npm ci --no-audit --no-fund

echo "→ generating the Prisma client"
npx prisma generate

# `migrate deploy` applies only what is missing and never reshapes destructively
# — unlike `db push`, which will happily drop a column to match the schema. On a
# database holding real training history that difference is the whole point.
echo "→ applying migrations"
npx prisma migrate deploy

echo "→ building"
rm -rf .next
npm run build

echo "→ restarting"
sudo systemctl restart fitness-app

sleep 3
if curl -fsS -o /dev/null http://localhost:3030/api/health; then
  echo "✓ up"
else
  echo "✗ not responding — journalctl -u fitness-app -n 50" >&2
  exit 1
fi
