# Agent Ops Architecture

[简体中文](architecture.zh-CN.md)

Status: in implementation (operational review phase)
Scope: self-hosted Agent observability platform and thin TypeScript/Python SDKs

Code-level module boundaries and executable constraints are documented in
[Code Architecture](code-architecture.md).

## 1. Goals

Agent Ops makes one agent run observable as a single trace, including its model
calls, tool calls, retrieval steps, planning steps, and sub-agents.

The first release must answer these operational questions:

1. Did the run finish successfully?
2. Which step failed, looped, or consumed unusual time or tokens?
3. Which model, prompt, application version, and environment produced the run?
4. What were the inputs and outputs, when content capture is allowed?
5. Can the run be found again by session, task type, status, model, or version?

The longer-term loop is:

```text
trace -> inspect -> curate dataset -> evaluate -> compare -> release -> monitor
```

## 2. Non-goals for the first milestone

- A general-purpose APM, log store, or metrics database.
- A replacement for the OpenTelemetry SDK or OTLP protocol.
- Online prompt editing.
- Multi-tenant billing.
- A full experiment platform before trace inspection works end to end.
- ClickHouse before PostgreSQL is measured as a bottleneck.

## 3. Architectural decisions

### 3.1 Reuse OpenTelemetry

Both SDKs are thin semantic wrappers over the official OpenTelemetry SDK:

| Language | Runtime foundation |
| --- | --- |
| TypeScript | `@opentelemetry/api`, `@opentelemetry/sdk-node` |
| Python | `opentelemetry-api`, `opentelemetry-sdk` |

The languages share contracts, constants, fixtures, and the OTLP wire format.
They do not share runtime context propagation, streaming adapters, or client
instrumentation code.

### 3.2 Modular monolith before service split

The first deployment has three processes:

- `web`: trace inspection and later evaluation views.
- `server`: OTLP ingest, query API, feedback, and scores.
- `worker`: aggregation and future asynchronous evaluation.

Ingest and query remain separate modules inside `server`. They may be split
later without changing the externally visible OTLP or query contracts.

### 3.3 PostgreSQL first

PostgreSQL is the system of record for sessions, traces, spans, feedback,
scores, datasets, and evaluation runs.

Full-content inspection is a product requirement, so raw content uses a
`ContentStore` abstraction backed by object storage:

- MinIO is the default self-hosted implementation.
- Alibaba Cloud OSS, AWS S3, or another S3-compatible service can replace
  MinIO through the same interface.
- Filesystem implementation only for unit tests.

The deployment uses one object-storage backend, not both MinIO and OSS at the
same time.

PostgreSQL span storage is the initial implementation. The persistence layer
must expose an interface so trace and span storage can move to ClickHouse if
measured query volume requires it.

### 3.4 OTLP is the ingestion boundary

SDKs emit traces through an OpenTelemetry exporter using OTLP over HTTP.

```text
SDK -> OTel SDK -> OTLP/HTTP exporter -> Agent Ops ingest
```

An OpenTelemetry Collector is supported in front of the ingest service for
central batching, filtering, and routing, but is not required for the first
single-team deployment.

The ingest receiver implements the OTLP HTTP trace endpoint:

```text
POST /v1/traces
Content-Type: application/x-protobuf
```

Ingest converts OTLP data into a canonical internal event model. Persistence
code does not depend on generated protobuf types.

### 3.5 Spans are immutable after export

Feedback and evaluation scores arrive after a trace ends. They are stored in
separate write paths and linked by `trace_id` and optionally `span_id`; they
never mutate an exported span.

### 3.6 Sampling and content capture are fixed at run start

Trace sampling and content capture are separate decisions:

- Trace sampling decides whether spans are exported for a run. The first
  release exports all `agent.run` roots. Any later head sampling must make one
  decision at the root and propagate it to all child spans.
- Content capture decides whether prompt, completion, and tool payloads are
  retained. It is evaluated before the run and cannot be changed retroactively
  by a failure, user feedback, or evaluation score.

A metadata-only trace cannot later recover its missing content. The platform
must not advertise failure-based or low-score-based content recovery unless
temporary encrypted capture was enabled before the run.

Collector tail sampling can be added later only when the SDK exports every
candidate span to the Collector. It changes trace persistence, not whether
content existed at the source.

### 3.7 Ingest is a machine-facing trust boundary

The human UI and query API use company SSO. Agent SDKs use separate
application-scoped machine credentials such as API keys, request signing, or
mTLS.

Ingest enforces request size, decompression, batch size, per-application rate,
and daily quota limits before decoding a payload. A partially valid OTLP batch
uses OTLP partial-success semantics so the exporter does not retry accepted
spans unnecessarily.

## 4. System context

```text
Agent application
  ├─ Agent Ops TS SDK
  └─ Agent Ops Python SDK
       |
       +-- OTLP/HTTP --> Ingest API
       |                    ├─ authenticate and limit
       |                    ├─ decode and validate OTLP
       |                    ├─ redact and limit attributes
       |                    └─ persist raw facts
       |                         |
       |                         v
       |                     PostgreSQL
       |                     spans, trace projections, feedback, scores
       |
       +-- bounded content upload --> Content API
                                      ├─ validate redaction and policy
                                      ├─ write content_objects metadata
                                      └─ write object payloads
                                           |
                                           v
                                      S3-compatible storage

Web UI -> Query API -> PostgreSQL

Score API <-- evaluation worker
```

A trace can also pass through an OTel Collector:

```text
SDK -> OTel Collector -> Ingest API
```

Collector responsibilities are deployment-specific; the application semantic
contract remains the same.

## 5. Repository layout

```text
apps/
  web/
  server/
  worker/
packages/
  contracts/
  sdk-typescript/
  sdk-python/
  test-agent-typescript/
  test-agent-python/
docs/
infra/
  docker-compose/
  collector/
```

The language SDKs and their test agents use the same path convention. The
directory named `packages` is the product module boundary; it does not imply
that every child is a Node.js package.

`packages/contracts` owns the machine-readable schema and generated constants.
The SDKs and server consume those artifacts rather than maintaining separate
attribute lists.

## 6. Component design

### 6.1 Contracts package

The source of truth is a versioned schema, initially:

```yaml
schema_version: "0.1"
namespace_prefix: "agent"
```

It defines:

- Resource attributes.
- Common and span-specific attributes.
- Span types and enumerations.
- Requirement levels and limits.
- Conformance levels L0, L1, and L2.
- Side-channel feedback and score fields.
- External telemetry mappings.

Generated outputs:

- TypeScript string constants, enums, and TypeScript types.
- Python enums, constants, and typed request models where useful.
- JSON Schema used by CI and server-side validation.

The specification file is reviewed like an API. New optional fields are
backward-compatible minor changes; required fields or semantic changes require
a major version.

### 6.2 Thin SDK

The public SDK focuses on agent concepts:

```text
agent_run
agent_step
llm_call
tool_call
retrieval
sub_agent
```

SDK responsibilities:

- Create and close spans with the required attributes.
- Propagate context across async work and process boundaries.
- Apply redaction before data leaves the process.
- Fix sampling and content-capture policy before the root run starts.
- Capture content through the content sink when policy allows it.
- Drop telemetry safely when the local upload queue is full.
- Report token usage and timing; do not compute authoritative cost.

The first TypeScript SDK targets Node.js. Browser support requires a separate
OpenTelemetry web integration and is not part of the first milestone.

SDK non-responsibilities:

- Persistence, querying, dashboards, or evaluation.
- Wrapping agent business logic.
- Inventing a custom transport protocol.
- Storing object-storage credentials.

### 6.3 Content capture

Attribute values contain summaries and object references only.

The content flow is:

```text
SDK redacts content
  -> SDK sends bounded content to the content endpoint
  -> content service validates policy, limits, and redaction state
  -> content service writes the object and content metadata
  -> span carries the opaque content ref, size, digest, and capture mode
```

The first release uses server-mediated upload so content cannot bypass
validation and redaction. Direct pre-signed S3 upload is allowed only after a
server-side scanner or quarantine workflow exists. In both cases, the SDK
configuration contains no permanent object-storage credential.

Capture policy is evaluated before upload:

| Environment | Default |
| --- | --- |
| dev | full |
| staging | full |
| production, approved app/task | full |
| production, restricted app/task | metadata only |

The MVP must include at least one approved production-like task that captures
and displays complete content. Production can still disable capture for
restricted task types. Failed and low-score traces cannot acquire content that
was not captured at run start.

Content upload is bounded and best effort. A timeout or storage failure marks
the related content as unavailable and must not delay or fail the agent's
user-facing request.

### 6.4 Ingest

Ingest performs:

1. Authenticate the calling application and enforce request and quota limits.
2. Decode OTLP protobuf into canonical spans.
3. Map recognized OpenInference/OpenLLMetry attributes when configured.
4. Validate schema version and required fields.
5. Redact known and unknown attributes and enforce attribute size limits.
6. Upsert span facts idempotently by `(trace_id, span_id)`.
7. Record batch statistics and rejected spans without rejecting valid spans
   from the same batch.
8. Enqueue trace aggregation work; ingest does not write trace summaries
   directly.

Unknown span types degrade to `custom`. Missing optional fields reduce the
features available for that trace but do not cause rejection. A partially
valid request returns OTLP partial success with the rejected span count and
reason.

### 6.5 Trace aggregation

Spans are facts and traces are a derived projection. The worker is the only
writer of trace summaries.

Spans can arrive out of order, so the aggregation process recomputes
trace-level fields from span facts rather than trusting SDK totals:

- Start and end time.
- Run status and stop reason.
- LLM, tool, retrieval, and sub-agent counts.
- Input and output tokens.
- Cost calculated per LLM span from the effective price table and then summed.
- Tool error count.
- Root span ID and session ID.

Aggregation jobs are deduplicated by `trace_id`. Each update takes a
per-trace database advisory lock or an equivalent serialized job lock, then
increments `aggregation_revision`.

A trace starts in `open`. It is sealed after the root span ends plus a
configurable grace period, initially 120 seconds, or after no new spans arrive
for the configured idle timeout, initially 15 minutes. A trace sealed without
a root span becomes `sealed_partial`; otherwise it becomes
`sealed_complete`. Span presence and success remain separate concepts.

Late spans accepted within the configured maximum lateness reopen aggregation
and update the sealed trace. The raw span is retained even when the trace is
already sealed. A span beyond maximum lateness is rejected with an explicit
late-data reason.

### 6.6 Query API

Initial endpoints:

```text
GET  /api/v1/traces
GET  /api/v1/traces/:traceId
GET  /api/v1/content/:contentId
POST /api/v1/feedback
POST /api/v1/traces/:traceId/reviews
GET  /api/v1/operations/ingest
GET  /api/v1/me
GET  /api/v1/metrics/overview
GET  /api/v1/metrics/breakdown
POST /api/v1/scores
GET  /api/v1/datasets
POST /api/v1/datasets
POST /api/v1/datasets/:datasetId/revisions
GET  /api/v1/evaluations
POST /api/v1/evaluations
GET  /api/v1/evaluations/:evaluationId
POST /api/v1/evaluations/:evaluationId/cancel
```

`/api/v1/scores` remains reserved for the evaluation phase. User feedback uses
an application credential and an idempotent `event_id`; internal reviews use
OIDC identity and are append-only.

Trace detail returns opaque content IDs and availability state. The content
endpoint checks the separate content-view permission, records an access audit,
and streams the object without loading the whole payload into memory. UI code
never receives object-storage credentials or internal bucket keys.

Trace list filters:

- Time range.
- Environment.
- Application and service.
- Task type.
- Run status.
- Model and prompt version.
- Session ID.
- Has errors.
- Review state.
- Cursor and time range.

Trace detail returns:

- Trace summary.
- Ordered span tree.
- Content references and availability.
- Feedback and scores.
- Ingest completeness information.

Metrics queries are added after the trace-reading path works. All UI metrics
must use one metrics query service with a shared metric dictionary; pages do
not issue their own aggregation SQL.

Trace metrics are stored in hourly PostgreSQL rollups. The Worker rebuilds a
complete hour when a trace projection changes, including its previous hour
when a late span moves the trace. Percentiles use a fixed cumulative latency
histogram and are displayed as estimates.

### 6.7 Web UI

First milestone screens:

1. Trace list with server-side filtering and pagination.
2. Trace detail with a span tree and timeline.
3. Span detail with attributes, errors, content, and timing.

The trace tree is the primary debugging surface. Every aggregate later added
to the dashboard must support drill-down to the filtered trace list.

## 7. Data model

The initial logical schema is:

```text
sessions
  session_id             text primary key
  first_seen_at          timestamptz
  last_seen_at           timestamptz
  redacted_user_id       text nullable

traces
  trace_id               text primary key
  session_id             text nullable
  root_span_id           text nullable
  app_name               text nullable
  service_name           text nullable
  service_version        text nullable
  environment            text nullable
  task_type              text nullable
  prompt_version         text nullable
  model                  text nullable
  run_status             text nullable
  stop_reason            text nullable
  first_span_at          timestamptz
  last_span_at           timestamptz
  start_time             timestamptz nullable
  end_time               timestamptz nullable
  root_ended_at          timestamptz nullable
  duration_ms            bigint nullable
  step_count             integer nullable
  llm_call_count         integer nullable
  tool_call_count        integer nullable
  tool_error_count       integer nullable
  input_tokens           bigint nullable
  output_tokens          bigint nullable
  cost_micros            bigint nullable
  currency               text nullable
  completeness           text nullable
  ingest_state           text
  sealed_at              timestamptz nullable
  aggregation_revision   bigint not null default 0

spans
  trace_id               text
  span_id                text
  parent_span_id         text nullable
  service_name           text nullable
  service_version        text nullable
  environment            text nullable
  span_type              text
  span_subtype           text nullable
  name                   text
  start_time             timestamptz
  end_time               timestamptz
  duration_ms            bigint
  status                 text
  error_type             text nullable
  error_category         text nullable
  resource_attributes    jsonb
  attributes              jsonb
  input_tokens           bigint nullable
  output_tokens          bigint nullable
  cached_input_tokens    bigint nullable
  reasoning_tokens       bigint nullable
  ttft_ms                bigint nullable
  cost_micros            bigint nullable
  price_version_id       uuid nullable
  input_content_ref      text nullable
  output_content_ref     text nullable
  content_recorded       text
  schema_version         text
  received_at            timestamptz
  primary key (trace_id, span_id)

feedback
  id                     uuid primary key
  trace_id               text
  span_id                text nullable
  event_id               text nullable
  actor_ref              text nullable
  type                   text
  comment                text nullable
  created_at             timestamptz

trace_reviews
  id                     uuid primary key
  trace_id               text
  reviewer_subject       text
  reviewer_name          text
  status                 text
  issue_area             text nullable
  comment                text nullable
  created_at             timestamptz

scores
  id                     uuid primary key
  trace_id               text
  span_id                text nullable
  name                   text
  value                  jsonb
  source                 text
  evaluator_version      text
  comment                text nullable
  created_at             timestamptz

span_events
  trace_id               text
  span_id                text
  event_index            integer
  name                   text
  event_time             timestamptz
  attributes              jsonb
  primary key (trace_id, span_id, event_index)

content_objects
  content_id             uuid primary key
  object_key             text unique
  owner_app              text
  content_kind           text
  media_type             text
  capture_mode           text
  size_bytes             bigint
  sha256                 text
  redaction_rule_version text
  encryption             text
  status                 text
  created_at             timestamptz
  expires_at             timestamptz nullable

content_access_log
  id                     uuid primary key
  content_id             uuid
  actor_subject          text nullable
  decision               text
  reason                 text nullable
  created_at             timestamptz

auth_sessions
  session_hash           text primary key
  subject                text
  display_name           text
  email                  text nullable
  role                   text
  expires_at             timestamptz
  created_at             timestamptz

ingest_batches
  batch_id               uuid primary key
  owner_app              text
  credential_id          text
  received_at            timestamptz
  request_bytes          bigint
  payload_digest         text
  span_count             integer
  accepted_count         integer
  rejected_count         integer
  status                 text

ingest_rejects
  id                     uuid primary key
  batch_id               uuid
  trace_id               text nullable
  span_id                text nullable
  reason                 text
  payload_ref            text nullable
  created_at             timestamptz

trace_aggregation_jobs
  trace_id               text primary key
  state                  text
  requested_at           timestamptz
  started_at             timestamptz nullable
  completed_at           timestamptz nullable
  attempt_count          integer
  last_error             text nullable

price_versions
  id                     uuid primary key
  provider               text
  model_pattern          text
  currency               text
  pricing_tier           text
  input_micros_per_million_tokens     bigint
  output_micros_per_million_tokens    bigint
  cached_input_micros_per_million_tokens bigint nullable
  reasoning_micros_per_million_tokens bigint nullable
  effective_from         timestamptz
  effective_to           timestamptz nullable
  source_url             text nullable
  notes                  text nullable
```

Dataset revisions are immutable, and items snapshot input, baseline output, and
expected output content independently from trace retention. Evaluation runs pin
a dataset revision and evaluator version, match candidate traces by
`agent.eval.case_id`, and execute deterministic rules asynchronously in the
worker before appending scores. The admin-enabled DeepSeek judge uses the same
run model, requires explicit external-content consent, validates a fixed
`score/pass/reason/category` response, and audits prompt/response objects and
token usage.

`price_versions` is insert-only. For each LLM span, the worker selects the
version matching provider, model, currency, pricing tier, and span start time,
stores both the calculated `cost_micros` and `price_version_id` on the span,
and then sums the values into the trace projection. DeepSeek peak/off-peak
rules are documented in [pricing.md](pricing.md).

The nullable trace fields are intentional. A child span can create the trace
projection before its root span arrives, so business status and root-only
metadata remain unknown until aggregation can fill them.

Initial indexes:

```text
traces(start_time desc, trace_id)
traces(environment, run_status, start_time desc)
traces(app_name, service_version, start_time desc)
traces(model, start_time desc)
traces(session_id, start_time desc)
content_objects(status, expires_at)
ingest_rejects(batch_id, created_at)
```

The `spans(trace_id, span_id)` primary key covers trace-tree lookup. Additional
indexes are added only from measured query patterns.

The initial capacity baseline is one million spans per day and 30 days of hot
metadata retention. These values are load-test targets, not permanent limits.
Before production traffic, the team must load-test that envelope and record
query and ingest latency. The first scale response is trace pre-aggregation;
ClickHouse is considered only when PostgreSQL misses the agreed targets after
index and query tuning.

Metadata and content have independent retention policies. Dataset items copy
the data they need instead of retaining references to trace content that may
later expire.

## 8. Idempotency and data integrity

- Span identity is `(trace_id, span_id)`.
- First-write-wins applies to span semantic fields. An identical duplicate is
  accepted idempotently; a conflicting duplicate is rejected and audited.
- A trace summary is derived from spans and can be rebuilt.
- Every rejected record includes a reason and ingestion batch ID.
- A trace remains queryable when its root span is missing, but the UI marks it
  as an orphan/incomplete trace.
- Redaction state and rule version are recorded.
- Every span retains its own service and resource attributes, so cross-service
  sub-agents do not inherit another service's identity.
- Trace states are `open`, `sealed_complete`, and `sealed_partial`.

Aggregation uses `aggregation_revision` to reject stale updates. A late span
within the configured lateness window increments the revision and triggers a
new aggregation; the latest committed revision wins.

## 9. Failure behavior

| Failure | Behavior |
| --- | --- |
| SDK upload queue full | Drop telemetry, increment dropped counter |
| OTLP endpoint unavailable | Keep bounded queue, retry according to exporter policy |
| Object storage unavailable | Store metadata and content unavailable state |
| Invalid application credential | Return an authentication error without accepting spans |
| Rate or quota exceeded | Return retryable throttling where appropriate and record the rejection |
| One invalid span in a batch | Persist valid spans, record the invalid span, return OTLP partial success |
| Unknown property | Preserve in extension object |
| Unknown span type | Degrade to `custom` |
| Query exceeds limit | Reject or coarsen the requested time bucket |
| Aggregation delayed | Keep the trace open or partial; raw spans remain available |

Telemetry must never make the agent's user-facing request fail.

## 10. Security and privacy

- Content capture requires an approved application/task policy. Unapproved
  production scopes remain metadata-only.
- Redaction occurs in the SDK before network export. Content-service and ingest
  validation enforce the same policy on data that reaches the platform.
- Unknown span attributes are size-limited and pass through redaction; preserving
  unknown fields never means preserving them without checks.
- User IDs are hashed or replaced with pseudonymous identifiers.
- Agent SDKs authenticate with application-scoped machine credentials that are
  separate from human SSO credentials.
- Object-storage references are not bearer credentials.
- Content objects are encrypted at rest and are exposed through opaque content
  IDs; object-store keys remain internal.
- The human UI and query API sit behind internal authentication, initially
  company SSO.
- Logs never include captured prompt bodies or authorization values.
- Content viewing uses a separate permission from metadata viewing and produces
  an access audit record.

## 11. Deployment

Local development:

```text
web + server + worker + PostgreSQL + MinIO
```

Single-team deployment:

```text
web + server + worker
  + managed PostgreSQL
  + MinIO or OSS/S3-compatible object storage
```

SDK and content requests use TLS. Application machine credentials are held in
the agent runtime's secret manager and have per-application scope and rotation.

An optional OTel Collector is placed before ingest when central filtering,
batching, or export to a separate APM is required.

## 12. MVP delivery slices

### Slice 1: walking skeleton

- Contracts v0.1.
- Node.js TypeScript SDK with `agent_run`, `llm_call`, and `tool_call`.
- Python SDK with the same core behavior.
- Authenticated OTLP ingest with request and quota limits.
- PostgreSQL and MinIO persistence.
- Server-mediated full-content capture in object storage.
- Out-of-order span storage and the initial trace sealing state machine.
- Trace list, trace tree, and prompt/completion/tool-payload views.

Exit criterion: one real agent run from either SDK appears as one complete
trace, its failed tool step is identifiable, and the operator can inspect the
captured prompt, completion, tool arguments, and tool output.

### Slice 2: operational completeness

- Session and version metadata.
- Content access policy, retention controls, and content-object lifecycle.
- Feedback writes.
- Error, model, task type, and version filters.
- Ingest health, batch statistics, and rejected-record visibility.

Exit criterion: an operator can locate a poor run from the previous day and
inspect its inputs, outputs, model calls, and tool failure.

### Slice 3: analytics

- Trace projection indexes and metric dictionary.
- Time-bucket pre-aggregation.
- First dashboards with drill-down.
- Capacity load test for the initial one-million-spans-per-day envelope.
- Index and partition decision based on measured query plans.
- Storage retention and archive jobs.

Implemented in Phase 3: shared metric definitions, hourly rollups, estimated
latency histograms, overview/breakdown APIs, and a dashboard with trace
drill-down. Capacity evidence and metadata archive policy remain rollout work.

Exit criterion: cost, status, latency, and tool failure rate use one agreed
definition and can navigate to the underlying traces.

### Slice 4: evaluation loop

- Dataset creation from a trace.
- Rule and LLM-judge evaluation.
- Experiment comparison by app and prompt version.
- Online sampled evaluation and alerts.

Exit criterion: a prompt change can be compared against a versioned dataset on
quality, cost, and latency before release.

## 13. Open design decisions

These do not block the walking skeleton:

1. Whether `agent.span.type` remains the only semantic discriminator or a
   second hierarchy property is added for sub-agents.
2. Whether LLM spans use official `gen_ai.*` names directly or an internal
   canonical form mapped at the edge.
3. The authoritative definition of `success`, `partial`, and `failed`.
4. The default retention period for trace metadata and captured content.
5. The price-table owner and supported currencies.
6. The exact framework and component library for the web application.
7. Whether metrics require ClickHouse after measuring PostgreSQL performance.
8. The initial trace-sealing grace and idle-timeout values after latency tests.
9. Whether a browser TypeScript SDK is required after the Node.js SDK ships.

## 14. First engineering tasks

1. Convert the draft attribute specification into a validated contracts schema.
2. Scaffold the TypeScript monorepo and Python package.
3. Implement a canonical span and resource model independent of OTLP protobuf
   types.
4. Implement ingest authentication, payload limits, quotas, and batch auditing.
5. Implement TypeScript and Python trace-context smoke tests and shared
   conformance fixtures.
6. Implement idempotent PostgreSQL persistence, aggregation jobs, trace
   sealing, and late-span handling.
7. Implement the server-mediated content path and content-object lifecycle.
8. Build the trace list and trace tree views against seeded fixture data.
9. Connect a real test agent through the full path.

