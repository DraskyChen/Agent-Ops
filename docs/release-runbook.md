# Production Release Runbook

## Preflight

1. Copy `.env.production.example` to `.env.production` and replace every
   placeholder.
2. Run `pnpm release:check`.
3. Run `pnpm check`.
4. Confirm the latest backup completed and its SHA-256 checks passed.
5. Confirm OIDC callback `OIDC_REDIRECT_URI` points to `/auth/callback` behind
   the final TLS hostname.

## Deploy

```bash
pnpm release:build
pnpm release:up
docker compose --env-file .env.production \
  -f infra/docker-compose/compose.production.yaml ps
```

The `migrate` service must complete before Server and Worker start. Do not
disable this ordering.

## Smoke

```bash
pnpm release:smoke
```

Then perform the human and SDK checks:

1. Sign in through OIDC with an admin and a reviewer account.
2. Send one trace using the TypeScript and Python SDKs with
   `agent.eval.case_id`.
3. Confirm the trace seals and appears in the Trace list.
4. Create a dataset revision and run one deterministic evaluator.
5. If Judge is enabled, run one approved DeepSeek case and verify prompt and
   response audit references.
6. Compare two completed runs over the same dataset revision.

## Monitoring

Watch at minimum:

- `/healthz` availability and database status.
- Ingest rejection rate and oldest aggregation job.
- Trace query P95 and PostgreSQL storage growth.
- Evaluation queue age, failed cases, and Judge error rate.
- DeepSeek token usage and spend ceiling.
- Backup completion and checksum status.

## Rollback

Application rollback and data rollback are separate actions.

- Application rollback: deploy the previous immutable image tags. Forward
  migrations are additive and remain applied.
- Data rollback: use `infra/backup/restore.sh` only after incident approval.
  It stops application services and fully replaces PostgreSQL and the object
  bucket.
- Record the incident time, selected backup, restore start/end time, smoke
  results, and any data written after the selected recovery point.

## Closure Criteria

The release is accepted only when:

- CI is green for quality, integration, and all container targets.
- Production configuration validation and smoke checks pass.
- OIDC human login and one real SDK trace pass.
- The selected DeepSeek Judge policy is verified or explicitly disabled.
- Backup and restore responsibilities, retention, and offsite replication are
  assigned to named operators.
- Capacity, query, and storage alerts have owners and thresholds.

