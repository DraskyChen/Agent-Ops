# Agent Ops 代码架构

[English](code-architecture.md)

状态：当前实现约束  
适用范围：`apps/*`、`packages/contracts`、`packages/sdk-*`

系统级目标和数据模型见 [架构设计](architecture.zh-CN.md)。本文约束代码如何落地，避免系统蓝图与实现逐渐分叉。

## 1. 设计原则

1. 模块化单体优先。Web、Server、Worker 是独立进程，但内部先通过清晰模块隔离，不提前拆微服务。
2. 依赖指向内层。HTTP 和数据库适配器可以依赖应用端口；应用层不反向依赖 Fastify、PostgreSQL 或 protobuf 库。
3. Composition Root 唯一。进程入口负责读取配置、创建连接池和组装适配器，业务代码不读取环境变量。
4. 契约只定义一次。浏览器和服务端共享的 API DTO 位于 `packages/contracts`，页面和服务端不各自复制同名模型。
5. Span 是事实，Trace 是投影。聚合计算必须是纯函数，数据库只负责装载事实和保存结果。
6. 可测试性属于边界设计。应用用例应能在不启动 HTTP 服务或数据库的情况下注入 fake 依赖运行。

## 2. 依赖方向

```text
process entry / composition
          |
          v
HTTP delivery ------> application use cases ------> ports
                                                    ^
                                                    |
                              PostgreSQL / OTLP adapters

contracts <---- server application / adapters
contracts <---- web feature

web app shell ---> traces feature ---> shared HTTP client
```

禁止的依赖：

- `http/**` 直接依赖数据库、连接池或 OTLP 实现。
- `application/**` 直接依赖 Fastify、`pg`、`protobufjs`。
- 基础设施适配器调用 HTTP 路由。
- Web feature 依赖 `Console.tsx`、`Landing.tsx`、根级 `api.ts` 或 mock fixture。
- Server、Web 重新定义 `TraceDetail`、`TraceListItem` 等共享 API 契约。

## 3. Server

```text
apps/server/src/
  app.ts                      Fastify 组装与 protobuf content parser
  composition.ts              生产依赖装配
  config.ts                   环境变量到类型化配置
  application/
    dependencies.ts           Server 用例端口
    auth.ts                   人类身份与角色规则
    ingest.ts                 OTLP 接入用例与错误语义
    traces.ts                 Trace 查询用例和输入规范化
    feedback.ts               用户反馈校验与幂等用例
    reviews.ts                内部审查用例
    operations.ts             运维健康查询用例
  http/
    ingest-auth.ts            机器凭证校验
    routes/                   HTTP 协议适配
  infrastructure/
    auth/                     dev 与 OIDC 身份适配器
    otlp/                     protobuf 解码与响应编码
    postgres/                 幂等写入和读取查询
  db/
    pool.ts                   连接池工厂
    migrate.ts                Schema migration CLI
```

OTLP 接入流程：

```text
HTTP request
  -> authenticate
  -> OtlpIngestService.receive(payload)
  -> codec.decode
  -> TraceBatchWriter.persist
  -> codec.encodeResponse
  -> protobuf response
```

查询流程：

```text
HTTP query
  -> TraceQueryService
  -> normalize filters, time range, and cursor
  -> TraceReadRepository
  -> PostgreSQL
```

路由只把 HTTP 输入翻译为用例输入，并把结果翻译为 HTTP 输出。数据库错误、protobuf 错误和认证失败在边界处映射为明确的 HTTP 语义。

## 4. Web

```text
apps/web/src/
  App.tsx                     顶层路径选择
  Console.tsx                 控制台外壳和导航
  Landing.tsx                 产品首页
  features/
    health/                   服务健康状态
    traces/
      api.ts                  API 到展示模型的适配
      model.ts                页面展示模型
      useTraceExplorer.ts     查询、选择和加载状态
      TraceListPage.tsx       列表页面
      TraceDetailPage.tsx     详情与 Span 树
      TracePrimitives.tsx     展示组件和格式化
  shared/
    http.ts                   通用 HTTP 客户端
```

API DTO 与展示模型分离是刻意设计：

- API DTO 表示跨进程稳定契约。
- `TraceView` / `TraceSpanView` 表示 UI 需要的派生字段，例如筛选状态、Span 深度和展示用摘要。
- 禁止为真实接口使用 `MockTrace`、`MockSpan` 等命名；演示 fixture 不得进入生产 feature 的模型路径。

## 5. Worker

```text
apps/worker/src/
  main.ts                     配置、进程生命周期和轮询
  application/
    aggregate-trace-job.ts    单次聚合用例与事务端口
  domain/
    trace-aggregation.ts      纯 Trace 投影计算
  infrastructure/
    postgres/
      aggregation-job-store.ts 队列、Span 读取和投影写入
```

`domain/trace-aggregation.ts` 不读取环境变量、不发起 I/O，也不依赖数据库。相同 Span 集合必须产生相同投影。PostgreSQL 负责 `FOR UPDATE SKIP LOCKED`、事务边界和持久化。

## 6. 共享契约

`packages/contracts` 有两个独立层次：

- 遥测契约：由 YAML 生成的属性、枚举和任务类型。
- API 契约：Trace 查询、Trace 详情、健康检查和错误响应。

`packages/metrics` 保存 Server 指标查询与 Worker 汇总共同使用的纯函数，
包括状态分母、固定延迟直方图、百分位估算和时间分桶，避免两个进程各维护一套口径。

新增跨进程字段时，顺序必须是：

1. 修改 `packages/contracts`。
2. 服务端适配器映射数据库字段。
3. Web 在 `features/*/api.ts` 中映射到展示模型。
4. 更新测试和架构说明。

不能先在 Server 中定义一个同名接口，再让 Web 手工复制。

## 7. 架构检查

运行：

```bash
pnpm architecture:check
```

检查器位于 `scripts/check-architecture.mjs`，在 `pnpm check` 中执行。当前会阻止：

- 应用层导入 HTTP 或基础设施模块。
- HTTP 层绕过应用端口直接导入数据库和 OTLP 适配器。
- 基础适配器反向依赖 HTTP。
- Web feature 反向依赖应用外壳。
- 生产 Web 代码出现 mock 模型命名。
- 共享 API DTO 在 contracts 之外重复定义。
- Worker 入口重新承担 SQL，或 domain/application 导入数据库驱动。

## 8. 当前债务与下一步

Phase 2 已补齐服务端筛选、游标分页、封口时钟、内容过期清理、OIDC 身份边界和内容访问审计。当前仍需继续收敛：

1. `infrastructure/postgres/ingest-store.ts` 仍是较大的事务脚本。下一步可拆成 `IngestBatchWriter`、`SpanWriter`、`SessionWriter` 和 `AggregationJobScheduler`，但应保持同一事务。
2. Trace 搜索仍基于 PostgreSQL `ILIKE` 和精确字段，达到容量目标前需要基于真实查询计划决定 trigram、复合索引或全文搜索。
3. Worker 当前通过 `not_before` 安排未来的封口任务；多 Worker 部署前仍需对内容保留扫描和任务吞吐做压力验证。
4. 内容隔离扫描尚未实现。当前已有独立查看权限、审计和保留期删除，但上传内容仍默认可信地进入 `available`。
5. OIDC 已支持标准发现、Authorization Code + PKCE 和服务端会话；具体身份提供商的 group claim、会话撤销 SLA 和 IdP 登出仍由部署方约定。
