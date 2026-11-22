#!/bin/sh
set -eu
umask 077

if [ "${CONFIRM_RESTORE:-}" != "yes" ]; then
  echo "Refusing to restore without CONFIRM_RESTORE=yes" >&2
  exit 1
fi

if [ "$#" -ne 1 ]; then
  echo "Usage: CONFIRM_RESTORE=yes $0 /path/to/backup-snapshot" >&2
  exit 1
fi

ROOT=$(CDPATH= cd -- "$(dirname "$0")/../.." && pwd)
COMPOSE_FILE=${COMPOSE_FILE:-"$ROOT/infra/docker-compose/compose.production.yaml"}
ENV_FILE=${ENV_FILE:-"$ROOT/.env.production"}
S3_BUCKET_NAME=${S3_BUCKET:-agent-ops-content}
SNAPSHOT=$1
DUMP="$SNAPSHOT/database/agent_ops.dump"
OBJECTS="$SNAPSHOT/objects"

if [ ! -f "$DUMP" ]; then
  echo "Database dump not found: $DUMP" >&2
  exit 1
fi
if [ ! -d "$OBJECTS" ]; then
  echo "Object backup directory not found: $OBJECTS" >&2
  exit 1
fi

compose() {
  docker compose --env-file "$ENV_FILE" -f "$COMPOSE_FILE" "$@"
}

verify_checksum() {
  file=$1
  checksum=$2
  if [ ! -f "$checksum" ]; then
    echo "Checksum file not found: $checksum" >&2
    exit 1
  fi
  if command -v sha256sum >/dev/null 2>&1; then
    sha256sum -c "$checksum"
  else
    shasum -a 256 -c "$checksum"
  fi
}

verify_checksum \
  "$DUMP" "$SNAPSHOT/database/agent_ops.dump.sha256"
if [ -f "$SNAPSHOT/objects.sha256" ]; then
  (
    cd "$OBJECTS"
    if command -v sha256sum >/dev/null 2>&1; then
      sha256sum -c "$SNAPSHOT/objects.sha256"
    else
      shasum -a 256 -c "$SNAPSHOT/objects.sha256"
    fi
  )
fi
compose exec -T postgres pg_restore -l < "$DUMP" > /dev/null

echo "Stopping application services"
compose stop web server worker

echo "Restoring PostgreSQL"
compose exec -T postgres sh -c \
  'PGPASSWORD="$POSTGRES_PASSWORD" pg_restore \
    --clean --if-exists --no-owner --no-privileges \
    -U "$POSTGRES_USER" -d "$POSTGRES_DB"' \
  < "$DUMP"

echo "Restoring object store bucket $S3_BUCKET_NAME"
compose run --rm --no-deps \
  -v "$OBJECTS:/backup:ro" \
  -e S3_BUCKET="$S3_BUCKET_NAME" \
  --entrypoint sh minio -c '
    mc alias set backup http://minio:9000 \
      "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
    mc mirror --overwrite --remove /backup "backup/$S3_BUCKET"
  '

echo "Reapplying forward migrations"
compose run --rm --no-deps migrate

echo "Starting application services"
compose up -d server worker web

echo "Restore complete. Run the production smoke test before reopening access."

