# Backup and Restore Drill

Date: 2026-11-23  
Environment: local PostgreSQL 16 and MinIO development stack

## Backup Contents

`infra/backup/backup.sh` creates one snapshot containing:

- PostgreSQL custom-format dump.
- MinIO/S3 bucket mirror.
- Git commit, branch, bucket name, and UTC creation time.
- SHA-256 checksums for the database dump, manifest, and every object.

Files are created with `umask 077`. Backups contain captured agent content and
must be stored on encrypted media with restricted access.

## Restore Behavior

`infra/backup/restore.sh` requires `CONFIRM_RESTORE=yes` and a snapshot path.
It verifies all checksums before making changes, stops Web/Server/Worker,
replaces the database and object bucket, reapplies forward migrations, and
restarts application services.

The restore is deliberately a full-environment replacement. It is not an
online partial restore tool.

## Drill Result

The actual development stack was backed up and restored into isolated temporary
targets:

| Check | Source | Restored |
| --- | ---: | ---: |
| Traces | 22 | 22 |
| Spans | 99 | 99 |
| Datasets | 2 | 2 |
| Evaluation runs | 0 | 0 |
| Scores | 0 | 0 |

All backed-up objects were restored to a temporary bucket and compared with the
backup directory using recursive `diff`; no differences were found. The
temporary database, bucket, and `/tmp` backup files were removed after the
drill.

## Remaining Production Work

- Measure backup duration and restore/RTO against a warmed 30-day database.
- Define and automate backup scheduling, retention, deletion approval, and
  offsite encrypted replication.
- Measure the recovery point objective using real ingestion traffic.
- Run a restore drill against an isolated copy of the production deployment.
- Document the operational approval and access procedure for restore.
