# Agent Ops Code Architecture

[简体中文](code-architecture.zh-CN.md)

Status: implementation constraints  
Scope: `apps/*`, `packages/contracts`, and `packages/sdk-*`

The system goals and logical data model are documented in [Architecture](architecture.md). This document defines how the code preserves those boundaries.

## Principles

1. Start with a modular monolith. Web, Server, and Worker are separate processes, but internal modules remain explicit and independently testable.
2. Dependencies point inward. HTTP and PostgreSQL adapters may depend on application ports; the application layer must not depend on Fastify, `pg`, or protobuf libraries.
3. Keep one composition root per process. Entry points load configuration and construct adapters. Business code does not read environment variables.
4. Define cross-process DTOs once in `packages/contracts`.
5. Spans are facts; Trace records are projections. Aggregation decisions are pure functions, and persistence remains in adapters.

## Dependency Direction

```text
entry / composition
        |
        v
HTTP delivery --> application use cases --> ports
                                            ^
                                            |
                         PostgreSQL / OTLP adapters

contracts <---- server and web consumers
web shell ----> feature ----> shared HTTP client
```

Architecture checks prevent HTTP routes from importing database or OTLP adapters, application code from importing infrastructure libraries, adapters from depending back on HTTP, and Web features from depending on app-shell files.

## Server

`app.ts` owns Fastify delivery concerns. `application/*` defines ingest, query,
feedback, review, operations, and human-auth use cases plus ports.
`infrastructure/otlp/*` handles protobuf, `infrastructure/auth/*` owns identity
providers, and `infrastructure/postgres/*` owns SQL. `composition.ts` is the
only production wiring point.

The OTLP path is:

```text
authenticate -> ingest use case -> decode -> persist canonical spans -> encode partial success
```

The query path is:

```text
HTTP query -> TraceQueryService -> normalized filters -> TraceReadRepository -> PostgreSQL
```

Human requests use opaque server-side sessions created through OIDC
Authorization Code + PKCE. Application SDK requests continue to use separate
machine credentials. Content reads require the reviewer role and are audited.

## Web

Trace UI code lives under `features/traces`. API adapters convert the shared contract into UI-specific `TraceView` and `TraceSpanView` models. Pages do not know whether data originated from PostgreSQL or another repository implementation. Production model names do not carry a mock prefix.

## Worker

`domain/trace-aggregation.ts` computes an `AggregatedTrace` from stored spans without I/O. `application/aggregate-trace-job.ts` controls one job through transaction ports. `infrastructure/postgres/aggregation-job-store.ts` owns row locking and SQL.

## Contracts

`packages/contracts` contains both generated telemetry identifiers and the stable HTTP API DTOs. New cross-process fields are added to contracts first, then mapped by server adapters and web feature adapters. Duplicate DTO definitions outside contracts fail the architecture check.

`packages/metrics` contains the shared pure metric definitions consumed by both
the Server query service and the Worker rollup builder. It owns status
denominators, software latency histograms, percentile estimation, and time
bucketing so those rules cannot diverge between processes.

## Enforcement

```bash
pnpm architecture:check
```

The check is part of `pnpm check`. The current rules and remaining implementation debt are documented in the [Chinese code architecture guide](code-architecture.zh-CN.md).
