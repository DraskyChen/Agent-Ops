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
- PostgreSQL persistence, trace aggregation, trace list, and trace detail APIs.
- Server-mediated full-content upload and retrieval backed by MinIO.
- TypeScript and Python SDK content capture with `content_id` span references.
- Live web console backed by `/api/v1/traces`.
- Independent PostgreSQL and MinIO development stack.

Not implemented yet:

- Evaluation, feedback, and score workflows.

## Local development

```bash
pnpm install
pnpm contracts:generate
pnpm architecture:check
pnpm infra:up
pnpm db:migrate
pnpm typecheck
pnpm test
```

If Docker uses a non-default context:

```bash
DOCKER_CONTEXT=orbstack pnpm infra:up
```

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

Emit real traces through the TypeScript examples:

```bash
pnpm examples:ts
```

See [examples/README.md](examples/README.md) for individual TypeScript and
Python examples.


