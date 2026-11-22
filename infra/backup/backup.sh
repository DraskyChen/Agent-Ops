#!/bin/sh
set -eu
umask 077

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-"$ROOT/infra/docker-compose/compose.production.yaml"}
ENV_FILE=${ENV_FILE:-"$ROOT/.env.production"}
BACKUP_ROOT=${BACKUP_ROOT:-"$ROOT/backups"}
S3_BUCKET_NAME=${S3_BUCKET:-agent-ops-content}

if [ ! -f "$ENV_FILE" ]; then
  echo "Environment file not found: $ENV_FILE" >&2
  exit 1
fi

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
snapshot="$BACKUP_ROOT/agent-ops-$timestamp"
mkdir -p "$snapshot/database" "$snapshot/objects"

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

checksum_file() {
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum "$1"
  else
    shasum -a 256 "$1"
  fi
}

echo "Backing up PostgreSQL to $snapshot/database/agent_ops.dump"
compose exec -T postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "$snapshot/database/agent_ops.dump"

compose exec -T postgres pg_restore -l \
  < "$snapshot/database/agent_ops.dump" > /dev/null

echo "Mirroring object store bucket $S3_BUCKET_NAME"
compose run --rm --no-deps \
  -v "$snapshot/objects:/backup" \
  -e S3_BUCKET="$S3_BUCKET_NAME" \
  --entrypoint sh minio -c '
    mc alias set backup http://minio:9000 \
      "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc mirror --overwrite "backup/$S3_BUCKET" /backup
  '

cat > "$snapshot/manifest.txt" <<EOF
created_at=$timestamp
git_commit=$(git -C "$ROOT" rev-parse HEAD)
git_branch=$(git -C "$ROOT" branch --show-current)
database_format=custom
object_bucket=$S3_BUCKET_NAME
EOF

checksum_file "$snapshot/database/agent_ops.dump" \
  > "$snapshot/database/agent_ops.dump.sha256"
checksum_file "$snapshot/manifest.txt" > "$snapshot/manifest.txt.sha256"
(
  cd "$snapshot/objects"
  find . -type f -print | LC_ALL=C sort | while IFS= read -r file; do
    checksum_file "$file"
  done
) > "$snapshot/objects.sha256"

echo "Backup complete: $snapshot"

