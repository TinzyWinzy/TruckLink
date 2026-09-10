#!/usr/bin/env bash
# Nightly Postgres dump -> gzip -> OCI Object Storage (S3-compatible) via rclone.
# Prereqs on the VM: rclone installed, `rclone config` remote named `oci-bak`
# (type s3, provider Other, endpoint <namespace>.compat.objectstorage.<region>.oraclecloud.com).
# Cron: 0 2 * * * /opt/opshield/backup.sh >> /var/log/opshield-backup.log 2>&1
set -euo pipefail

COMPOSE="docker compose -f /opt/opshield/docker-compose.yml"
BACKUP_DIR="/var/backups/opshield"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
KEEP_LOCAL=7

mkdir -p "$BACKUP_DIR"
cd /opt/opshield 2>/dev/null || cd "$(dirname "$0")/.."

$COMPOSE exec -T postgres pg_dump -U postgres -d bak_logistics \
  | gzip -9 > "$BACKUP_DIR/bak-$STAMP.sql.gz"

# Keep a week locally, everything remote (20 GB Always Free object allowance).
find "$BACKUP_DIR" -name 'bak-*.sql.gz' -mtime +$KEEP_LOCAL -delete
rclone copyto "$BACKUP_DIR/bak-$STAMP.sql.gz" "oci-bak:bak-db-backups/bak-$STAMP.sql.gz"

echo "[$STAMP] backup ok"
