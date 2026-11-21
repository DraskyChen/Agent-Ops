# Agent Ops 架构设计

[English](architecture.md)

状态：实施中（运维审查阶段）
范围：私有化 Agent 可观测平台，以及轻量 TypeScript/Python SDK

代码模块边界和可执行约束见 [代码架构](code-architecture.zh-CN.md)。

## 1. 目标

Agent Ops 要让一次 Agent 运行成为一条可完整查看的 Trace，包含其中的模型调用、工具调用、检索步骤、规划步骤和子 Agent。

第一阶段必须回答以下运维问题：

1. 这次运行是否成功结束？
2. 哪个步骤失败、发生了循环，或者消耗了异常的时间或 token？
3. 这次运行使用了哪个模型、Prompt、应用版本和运行环境？
4. 在允许记录内容时，输入和输出分别是什么？
5. 能否按会话、任务类型、状态、模型或版本再次找到这次运行？

长期目标是形成以下闭环：

```text
追踪 -> 排障 -> 沉淀数据集 -> 评测 -> 对比 -> 发布 -> 线上监控
```

## 2. 第一里程碑不做的事

- 通用 APM、日志平台或指标数据库。
- 替代 OpenTelemetry SDK 或 OTLP 协议。
- 在线 Prompt 编辑器。
- 多租户计费。
- 在 Trace 排障还未端到端跑通前，提前建设完整实验平台。
- 在 PostgreSQL 被实测证明存在瓶颈前，提前引入 ClickHouse。

## 3. 架构决策

### 3.1 复用 OpenTelemetry

两个 SDK 都只作为官方 OpenTelemetry SDK 之上的轻量语义封装：

| 语言 | 运行时基础 |
| --- | --- |
| TypeScript | `@opentelemetry/api`、`@opentelemetry/sdk-node` |
| Python | `opentelemetry-api`、`opentelemetry-sdk` |

两种语言共享数据契约、常量、测试样例和 OTLP 传输格式，但不共享运行时的 Context 传播、流式处理适配器和客户端插桩代码。

### 3.2 先做模块化单体

第一版部署包含三个进程：

- `web`：Trace 查看，以及后续的评测视图。
- `server`：OTLP 接入、查询 API、用户反馈和评分。
- `worker`：聚合，以及后续的异步评测任务。

接入和查询先是 `server` 内部的两个独立模块。后续拆分服务时，对外暴露的 OTLP 和查询契约不需要变化。

### 3.3 PostgreSQL 优先

PostgreSQL 是以下数据的系统记录源：

- 会话。
- Trace。
- Span。
- 用户反馈。
- 评分。
- 数据集。
- 评测运行。

完整内容查看是产品要求，因此原始内容通过基于对象存储的 `ContentStore` 抽象保存：

- 私有化部署默认使用 MinIO。
- 阿里云 OSS、AWS S3 或其他兼容 S3 的服务可以通过同一接口替换 MinIO。
- 文件系统实现仅用于单元测试。

同一次部署只使用一个对象存储后端，不同时部署 MinIO 和 OSS。

初期 Span 存储在 PostgreSQL。持久化层必须提供接口隔离，以便在实测查询量需要时，将 Trace 和 Span 存储迁移到 ClickHouse。

### 3.4 OTLP 是接入边界

SDK 通过 OpenTelemetry Exporter，使用 OTLP over HTTP 上报 Trace：

```text
SDK -> OTel SDK -> OTLP/HTTP Exporter -> Agent Ops Ingest
```

可以在 Ingest 服务前增加 OpenTelemetry Collector，用于集中批处理、过滤和路由；但第一版单团队部署不强制要求 Collector。

Ingest 实现 OTLP HTTP Trace 接收端点：

```text
POST /v1/traces
Content-Type: application/x-protobuf
```

Ingest 将 OTLP 数据转换为平台内部的统一事件模型。持久化代码不直接依赖生成的 protobuf 类型。

### 3.5 Span 导出后不可变

用户反馈和评测分数通常在 Trace 结束后才产生。它们走独立的写入路径，通过 `trace_id` 以及可选的 `span_id` 关联，不会修改已经导出的 Span。

### 3.6 采样和内容捕获在运行开始时确定

Trace 采样和内容捕获是两个独立决策：

- Trace 采样决定一次运行是否导出 Span。第一版完整导出所有 `agent.run` 根 Span。后续若增加头部采样，必须在根节点做一次决策，并传播给全部子 Span。
- 内容捕获决定是否保留 Prompt、回复和工具载荷。该策略在运行开始前确定，不能因为运行失败、用户反馈或评测低分而追溯改变。

选择了“仅元数据”的 Trace 无法在事后恢复当时没有记录的内容。除非运行前已经开启临时加密捕获，否则平台不能宣称能够按失败或低分状态恢复内容。

后续可以增加 Collector 尾采样，但前提是 SDK 将所有候选 Span 发送到 Collector。尾采样只改变 Trace 是否持久化，不能改变源端是否曾经捕获内容。

### 3.7 Ingest 是面向机器的信任边界

面向人的 UI 和查询 API 使用公司 SSO。Agent SDK 使用独立的、按应用授权的机器凭证，例如 API Key、请求签名或 mTLS。

Ingest 在解码前限制请求体大小、解压后大小、批次大小、单应用速率和每日配额。部分有效的 OTLP 批次使用 OTLP partial success 语义，避免 Exporter 对已经接收的 Span 进行无意义重试。

## 4. 系统上下文

```text
Agent 应用
  ├─ Agent Ops TS SDK
  └─ Agent Ops Python SDK
       |
       +-- OTLP/HTTP --> Ingest API
       |                    ├─ 校验机器身份和执行限制
       |                    ├─ 解码并校验 OTLP
       |                    ├─ 脱敏并限制属性大小
       |                    └─ 持久化原始事实
       |                         |
       |                         v
       |                     PostgreSQL
       |                     Span、Trace 投影、反馈、评分
       |
       +-- 有界内容上传 --> Content API
                              ├─ 校验脱敏状态和捕获策略
                              ├─ 写入 content_objects 元数据
                              └─ 写入对象载荷
                                   |
                                   v
                              兼容 S3 的对象存储

Web UI -> Query API -> PostgreSQL

Score API <-- 评测 Worker
```

也可以在 SDK 和 Ingest 之间增加 OTel Collector：

```text
SDK -> OTel Collector -> Ingest API
```

Collector 的职责取决于部署形态；应用侧的语义契约保持不变。

## 5. 仓库结构

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

两种语言的 SDK 和测试 Agent 使用同一套路径规则。这里的 `packages` 表示产品模块边界，并不表示其下每个目录都必须是 Node.js 包。

`packages/contracts` 是机器可读规范和生成常量的唯一来源。SDK 和 Server 都消费这些产物，不在各自仓库中维护另一份属性列表。

## 6. 组件设计

### 6.1 契约包

唯一事实来源是一份带版本号的 Schema，初始版本为：

```yaml
schema_version: "0.1"
namespace_prefix: "agent"
```

它定义：

- Resource 属性。
- 通用属性和各类 Span 专属属性。
- Span 类型和枚举。
- 必填等级和取值限制。
- L0、L1、L2 接入等级。
- 事后反馈和评分的旁路写入字段。
- 外部遥测数据的属性映射。

生成的产物包括：

- TypeScript 字符串常量、枚举和类型。
- Python 枚举、常量，以及在必要时使用的类型化请求模型。
- 供 CI 和服务端校验使用的 JSON Schema。

规范文件应当按照 API 的标准进行评审。新增选填字段属于向后兼容的次版本变更；修改必填字段或语义属于主版本变更。

### 6.2 轻量 SDK

对外 SDK 聚焦 Agent 语义：

```text
agent_run
agent_step
llm_call
tool_call
retrieval
sub_agent
```

SDK 负责：

- 创建和结束带必填属性的 Span。
- 在异步任务和跨进程调用中传播 Context。
- 在数据离开进程前完成脱敏。
- 在根运行开始前确定采样和内容捕获策略。
- 在策略允许时，通过内容通道捕获完整内容。
- 本地上报队列满时安全丢弃遥测数据。
- 上报 token 用量和耗时，不负责计算权威费用。

第一版 TypeScript SDK 只面向 Node.js。浏览器支持需要单独使用 OpenTelemetry Web 集成，不属于第一里程碑范围。

SDK 不负责：

- 持久化、查询、看板或评测。
- 包装 Agent 的业务逻辑。
- 发明自定义传输协议。
- 保存对象存储凭证。

### 6.3 内容捕获

属性值只包含摘要和对象引用，不保存完整内容。

内容流转方式如下：

```text
SDK 脱敏内容
  -> SDK 将有限大小的内容发送到内容接口
  -> 内容服务校验策略、限制和脱敏状态
  -> 内容服务写入对象和内容元数据
  -> Span 携带不透明内容引用、大小、摘要和捕获模式
```

第一版必须由服务端代理上传，避免内容绕过校验和脱敏。只有在服务端扫描或隔离流程就绪后，才允许改为 S3 预签名直传。两种方式下，SDK 配置中都不包含长期对象存储凭证。

内容捕获策略在上传前执行：

| 环境 | 默认策略 |
| --- | --- |
| dev | 完整记录 |
| staging | 完整记录 |
| production，已审批应用/任务 | 完整记录 |
| production，受限应用/任务 | 仅记录元数据 |

MVP 必须至少包含一个类生产任务，能够捕获并展示完整内容。生产环境仍然可以对受限任务类型关闭捕获。失败或低分 Trace 无法获得在运行开始时没有捕获的内容。

内容上传采用有限时间和尽力而为策略。上传超时或存储失败时，将相关内容标记为不可用，不能因此延迟或导致 Agent 面向用户的请求失败。

### 6.4 Ingest

Ingest 执行以下操作：

1. 校验调用应用的机器身份，并执行请求体和配额限制。
2. 将 OTLP protobuf 解码为统一 Span 模型。
3. 在配置允许时，映射 OpenInference、OpenLLMetry 等已识别属性。
4. 校验 Schema 版本和必填字段。
5. 对已知和未知属性执行脱敏，并限制属性大小。
6. 按 `(trace_id, span_id)` 幂等写入 Span 事实。
7. 记录批次统计和被拒绝的 Span，同时不影响同一批次中的其他有效 Span。
8. 投递 Trace 聚合任务；Ingest 不直接写 Trace 汇总。

未知 Span 类型降级为 `custom`。缺少选填字段只会降低该 Trace 可用的功能，不会导致拒收。部分有效请求返回 OTLP partial success，并携带被拒绝 Span 数量和原因。

### 6.5 Trace 聚合

Span 是事实数据，Trace 是派生投影。Worker 是 Trace 汇总的唯一写入者。

Span 可能乱序到达，因此聚合流程根据 Span 事实重新计算 Trace 级字段，不直接信任 SDK 上报的汇总值：

- 开始和结束时间。
- 运行状态和停止原因。
- LLM、工具、检索和子 Agent 的调用次数。
- 输入和输出 token。
- 根据生效价目表按 LLM Span 计算费用，再汇总到 Trace。
- 工具错误数。
- 根 Span ID 和会话 ID。

聚合任务按 `trace_id` 去重。每次更新使用按 Trace 加锁的数据库 advisory lock 或等价的串行任务锁，并递增 `aggregation_revision`。

Trace 初始状态为 `open`。根 Span 结束并经过可配置宽限期后封口，初始宽限期为 120 秒；或者在没有新 Span 到达并超过可配置空闲超时后封口，初始空闲超时为 15 分钟。没有根 Span 的封口 Trace 标记为 `sealed_partial`，有根 Span 的标记为 `sealed_complete`。Span 是否到达与业务是否成功是两个独立概念。

在可配置最大迟到时间内接收到的迟到 Span 会重新触发聚合并更新已封口 Trace。即使 Trace 已封口，原始 Span 仍会保留。超过最大迟到时间的 Span 会被拒绝，并记录明确的迟到原因。

### 6.6 Query API

初始接口：

```text
GET  /api/v1/traces
GET  /api/v1/traces/:traceId
GET  /api/v1/content/:contentId
POST /api/v1/feedback
POST /api/v1/traces/:traceId/reviews
GET  /api/v1/operations/ingest
GET  /api/v1/me
POST /api/v1/scores
```

`/api/v1/scores` 保留给后续评测阶段。用户 Feedback 使用应用凭证并通过
`event_id` 保证幂等；内部 Review 使用人类 OIDC 身份并且只追加。

Trace 详情返回不透明内容 ID 和内容可用状态。内容接口校验独立的内容查看权限、记录访问审计，并以流式方式返回对象，避免将完整载荷一次性加载到内存。前端永远不会获得对象存储凭证或内部 Bucket Key。

Trace 列表筛选条件：

- 时间范围。
- 环境。
- 应用和服务。
- 任务类型。
- 运行状态。
- 模型和 Prompt 版本。
- 会话 ID。
- 是否存在错误。
- 审查状态。
- 时间范围与游标。

Trace 详情返回：

- Trace 汇总。
- 按时间排序的 Span 树。
- 内容引用和可用状态。
- 用户反馈和评分。
- 数据接入完整度。

指标查询在 Trace 读取链路跑通后再加入。所有 UI 指标必须通过统一的指标查询服务读取，并使用共享的指标字典；页面不得各自编写聚合 SQL。

### 6.7 Web UI

第一里程碑页面：

1. 支持服务端筛选和分页的 Trace 列表。
2. 包含 Span 树和时间线的 Trace 详情。
3. 展示属性、错误、内容和耗时的 Span 详情。

Trace 树是主要排障界面。后续每个看板图表都必须支持携带当前筛选条件下钻到 Trace 列表。

## 7. 数据模型

初始逻辑 Schema：

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

数据集和评测表在 Trace 纵向链路跑通后再设计。

`price_versions` 只追加、不原地修改。对每个 LLM Span，Worker 按提供方、模型、币种、价格档位和 Span 开始时间选择价目版本，将计算出的 `cost_micros` 和 `price_version_id` 写入 Span，再汇总到 Trace 投影。DeepSeek 高峰/低峰规则见 [pricing.md](pricing.md)。

Trace 投影中的可空字段是有意设计。子 Span 可能在根 Span 到达前先创建 Trace 投影，因此业务状态和只存在于根 Span 的元数据要等聚合后才能填充。

初始索引：

```text
traces(start_time desc, trace_id)
traces(environment, run_status, start_time desc)
traces(app_name, service_version, start_time desc)
traces(model, start_time desc)
traces(session_id, start_time desc)
content_objects(status, expires_at)
ingest_rejects(batch_id, created_at)
```

`spans(trace_id, span_id)` 主键已经覆盖 Trace 树查询。其他索引只根据实测查询模式增加。

初始容量基线为每天 100 万 Span、热元数据保留 30 天。这些数值是压测目标，不是永久限制。生产流量接入前必须对该容量做压测并记录查询与接入延迟。遇到扩展瓶颈时先做 Trace 预聚合；只有在索引和查询优化后仍无法达到约定目标时，才考虑 ClickHouse。

元数据和内容采用独立保留策略。数据集条目复制所需数据，不长期引用可能过期的 Trace 内容对象。

## 8. 幂等性与数据完整性

- Span 的唯一标识是 `(trace_id, span_id)`。
- Span 语义字段采用 first-write-wins。完全相同的重复数据幂等接受；同一标识但内容冲突的重复数据会被拒绝并审计。
- Trace 汇总是由 Span 推导出的结果，必须支持重建。
- 每条被拒绝的记录都保留原因和接入批次 ID。
- 根 Span 缺失时，Trace 仍然可查询，但 UI 必须将其标记为孤儿或不完整 Trace。
- 记录脱敏状态和脱敏规则版本。
- 每个 Span 都保留自己的服务和 Resource 属性，跨服务子 Agent 不会错误继承其他服务的身份。
- Trace 状态为 `open`、`sealed_complete` 和 `sealed_partial`。

聚合使用 `aggregation_revision` 拒绝过期更新。在配置的迟到窗口内收到迟到 Span 时，递增 revision 并触发重新聚合；以最后提交的 revision 为准。

## 9. 故障行为

| 故障 | 行为 |
| --- | --- |
| SDK 上传队列已满 | 丢弃遥测数据并增加丢弃计数 |
| OTLP 端点不可用 | 在有限队列中暂存，并按 Exporter 策略重试 |
| 对象存储不可用 | 保留元数据，并将内容状态标记为不可用 |
| 应用凭证无效 | 返回认证错误，不接收任何 Span |
| 超过速率或配额 | 在适用时返回可重试的限流响应，并记录拒绝原因 |
| 批次中存在一个无效 Span | 保存有效 Span，记录无效 Span，并返回 OTLP partial success |
| 出现未知属性 | 原始保存在扩展对象中 |
| 出现未知 Span 类型 | 降级为 `custom` |
| 查询超过限制 | 拒绝查询，或自动降低时间桶粒度 |
| 聚合延迟 | Trace 保持开放或不完整状态，原始 Span 仍然可查询 |

遥测系统不能导致 Agent 面向用户的请求失败。

## 10. 安全与隐私

- 内容捕获需要经过应用/任务策略审批；未审批的生产范围仍只记录元数据。
- SDK 在网络上报前完成脱敏。内容服务和 Ingest 对到达平台的数据执行相同策略校验。
- 未知 Span 属性受到大小限制并经过脱敏；“保留未知字段”不代表未经检查原样保留。
- 用户 ID 使用哈希或其他假名标识。
- Agent SDK 使用按应用授权的机器凭证，与面向人的 SSO 凭证分离。
- 对象存储引用不能包含可长期使用的访问凭证。
- 内容对象静态加密，对外只暴露不透明内容 ID，对象存储 Key 保持内部可见。
- 面向人的 UI 和查询 API 置于内网认证之后，第一阶段使用公司 SSO。
- 普通日志不得包含捕获的 Prompt 内容或授权信息。
- 内容查看与元数据查看使用不同权限，并记录内容访问审计。

## 11. 部署

本地开发：

```text
web + server + worker + PostgreSQL + MinIO
```

单团队部署：

```text
web + server + worker
  + 托管 PostgreSQL
  + MinIO 或兼容 OSS/S3 的对象存储
```

SDK 和内容请求使用 TLS。应用机器凭证保存在 Agent 运行时的密钥管理系统中，按应用授权并支持轮换。

当需要集中过滤、批处理或同时向其他 APM 导出数据时，在 Ingest 前增加可选的 OTel Collector。

## 12. MVP 交付切片

### 切片 1：完整纵向骨架

- Contracts v0.1。
- Node.js TypeScript SDK，包含 `agent_run`、`llm_call` 和 `tool_call`。
- Python SDK，提供同样的核心能力。
- 带机器认证、请求限制和配额控制的 OTLP Ingest。
- PostgreSQL 和 MinIO 持久化。
- 通过服务端代理将完整内容写入对象存储。
- Span 乱序存储和初始 Trace 封口状态机。
- Trace 列表、Trace 树，以及 Prompt、回复和工具载荷查看页面。

退出标准：任意一个 SDK 中的一次真实 Agent 运行都能显示为一条完整 Trace，可以准确识别失败的工具步骤，并且运维人员可以查看捕获的 Prompt、模型回复、工具入参和工具输出。

### 切片 2：运维能力补齐

- 会话和版本元数据。
- 内容访问策略、保留配置和内容对象生命周期。
- 用户反馈写入。
- 错误、模型、任务类型和版本筛选。
- 接入健康状态、批次统计和拒收记录可见性。

退出标准：运维人员可以从前一天的数据中找到一次表现不佳的运行，并查看其输入、输出、模型调用和工具错误。

### 切片 3：分析能力

- Trace 投影索引和指标字典。
- 时间桶预聚合。
- 第一批可下钻的看板。
- 针对每天 100 万 Span 初始容量的压测。
- 基于实测查询计划的索引和分区决策。
- 存储保留期和归档任务。

退出标准：成本、状态、延迟和工具失败率均使用同一套经过确认的定义，并且可以从图表进入对应的 Trace。

### 切片 4：评测闭环

- 从 Trace 创建数据集。
- 规则评测和 LLM 判官。
- 按应用版本和 Prompt 版本进行实验对比。
- 线上抽样评测和告警。

退出标准：在发布前，可以基于带版本的数据集比较 Prompt 变更在质量、成本和延迟三个方面的表现。

## 13. 待定设计项

以下事项不会阻塞第一阶段的纵向骨架：

1. 是否继续只用 `agent.span.type` 表达语义分类，或者为子 Agent 增加独立层级属性。
2. LLM Span 直接使用官方 `gen_ai.*` 命名，还是先使用内部统一模型，再在边界处映射。
3. `success`、`partial` 和 `failed` 的权威判定标准。
4. Trace 元数据和捕获内容的默认保留期。
5. 价目表维护方和需要支持的币种。
6. Web 应用使用的具体框架和组件库。
7. 实测 PostgreSQL 性能后，指标是否确实需要迁移到 ClickHouse。
8. 延迟测试后确定的 Trace 封口宽限期和空闲超时默认值。
9. Node.js SDK 上线后是否需要浏览器 TypeScript SDK。

## 14. 第一批工程任务

1. 将草案属性规范转换为可校验的 Contracts Schema。
2. 搭建 TypeScript Monorepo 和 Python 包骨架。
3. 实现不依赖 OTLP protobuf 类型的统一 Span 和 Resource 模型。
4. 实现 Ingest 机器认证、请求限制、配额和批次审计。
5. 为 TypeScript 和 Python 实现 Trace Context 冒烟测试，以及共享一致性测试样例。
6. 实现 PostgreSQL 幂等写入、聚合任务、Trace 封口和迟到 Span 处理。
7. 实现服务端代理的内容链路和内容对象生命周期。
8. 基于种子数据构建 Trace 列表和 Trace 树页面。
9. 用一个真实测试 Agent 跑通完整链路。

