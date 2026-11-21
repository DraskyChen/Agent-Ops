# Agent Ops

[简体中文](README.zh-CN.md)

Agent Ops is a self-hosted observability platform for agent runs.

The first milestone is a complete vertical slice:

```text
TypeScript or Python agent
  -> thin Agent Ops SDK
  -> OpenTelemetry SDK
  -> OTLP ingest
  -> PostgreSQL and object storage
  -> trace list, trace tree, and complete content inspection
```

Design documents:

- [Architecture](docs/architecture.md)
- [Code architecture](docs/code-architecture.md)
- [Model pricing](docs/pricing.md)
- [架构设计（中文）](docs/architecture.zh-CN.md)

## Current implementation status

Implemented:

- Machine-readable Contracts v0.1 with generated TypeScript and Python values.
- Thin Node.js TypeScript and Python SDKs using the official OpenTelemetry SDKs.
- Agent run, LLM, tool, retrieval, and sub-agent span helpers.
- Shared redaction and attribute conventions.
- OTLP/HTTP protobuf ingest using OpenTelemetry Proto `v1.11.1`.
- PostgreSQL persistence and the trace aggregation/sealing worker.
- Server-side trace filters with stable cursor pagination.
- Server-mediated full-content upload and retrieval backed by MinIO.
- TypeScript and Python SDK content capture with `content_id` span references.
- User feedback ingestion with machine credentials and event idempotency.
- Append-only internal trace reviews with reviewer identity and issue classification.
- OIDC login with a local development identity mode and `viewer`, `reviewer`,
  and `admin` roles.
- Content access auditing, retention cleanup, and separate content viewing
  permission.
- Ingest health, rejection reasons, aggregation backlog, and Web operations page.
- Live trace list, detail, review, and content console backed by the query API.
- Independent PostgreSQL and MinIO development stack.

Not implemented yet:

- Datasets, automated scoring, rule evaluation, and LLM-judge workflows.

## Local development

```bash
pnpm install
pnpm contracts:build
pnpm architecture:check
pnpm infra:up
pnpm db:migrate
pnpm typecheck
pnpm test
pnpm test:integration
```

If Docker uses a non-default context:

```bash
DOCKER_CONTEXT=orbstack pnpm infra:up
```

`pnpm test:integration` requires the migrated PostgreSQL and MinIO development
stack. It verifies filters, feedback idempotency, reviews, operations health,
and expired-content auditing against the real database.

Python SDK:

```bash
uv sync --project packages/sdk-python --extra dev
uv run --project packages/sdk-python pytest -q
uv run --project packages/sdk-python mypy packages/sdk-python/src/agent_ops
```

Run the platform:

```bash
pnpm dev
```

Local development defaults to `AGENT_OPS_AUTH_MODE=dev`. OIDC mode requires
the `OIDC_*` values documented in `.env.example`; the server refuses to start in
production with the development identity mode.

Emit real traces through the TypeScript examples:

```bash
pnpm examples:ts
```

See [examples/README.md](examples/README.md) for individual TypeScript and
Python examples.


