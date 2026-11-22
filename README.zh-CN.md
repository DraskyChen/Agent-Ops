# Agent Ops

[English](README.md)

Agent Ops 是一个私有化部署的 Agent 运行可观测平台。

第一个里程碑是完成一条端到端纵向链路：

```text
TypeScript 或 Python Agent
  -> 轻量 Agent Ops SDK
  -> OpenTelemetry SDK
  -> OTLP 接入
  -> PostgreSQL 和对象存储
  -> Trace 列表、Trace 树和完整内容查看
```

设计文档：

- [架构设计](docs/architecture.zh-CN.md)
- [代码架构](docs/code-architecture.zh-CN.md)
- [模型价格](docs/pricing.md)
- [Architecture（英文）](docs/architecture.md)

## 当前实现状态

已完成：

- 机器可读的 Contracts v0.1，以及生成的 TypeScript、Python 常量和枚举。
- 基于官方 OpenTelemetry SDK 的 Node.js TypeScript SDK 和 Python SDK 骨架。
- Agent 运行、LLM、工具、检索和子 Agent 的 Span 封装。
- 统一的脱敏和属性约定。
- 基于 OpenTelemetry Proto `v1.11.1` 的 OTLP/HTTP protobuf 接入。
- PostgreSQL 持久化，以及 Worker 中的 Trace 聚合与分段封口。
- 服务端 Trace 组合筛选和稳定游标分页。
- 由 MinIO 支撑的服务端代理完整内容上传与读取。
- TypeScript 和 Python SDK 完整内容捕获及 Span `content_id` 关联。
- 使用应用凭证写入、按事件幂等的用户 Feedback。
- 带审核人身份和问题分类的追加式内部 Review。
- OIDC 登录、本地开发身份，以及 `viewer`、`reviewer`、`admin` 角色。
- 内容访问审计、过期清理和独立的内容查看权限。
- Ingest 健康状态、拒收原因、聚合积压和 Web Operations 页面。
- 基于 PostgreSQL 小时汇总和延迟直方图的共享 Trace 指标定义。
- 展示数量、状态、成本、延迟、工具错误以及应用/模型/任务/版本分布的运维 Dashboard。
- 支持从 Dashboard 按同一时间桶和结构化筛选条件下钻到 Trace 列表。
- 真实 Trace 列表、详情、审查和内容查看控制台。
- TypeScript/Python SDK 的可选 `agent.eval.case_id`，用于跨版本严格配对。
- 从已封口 Trace 创建不可变数据集修订，并复制输入、基线和期望输出内容。
- 评测运行 API、按 `case_id` 匹配候选 Trace，以及精确、包含、正则、
  JSON、延迟、成本和工具错误规则评测。
- 独立的 PostgreSQL 和 MinIO 开发环境。

尚未完成：

- Dataset/Evaluation Web 工作流。
- DeepSeek LLM Judge 和版本对比页面。

## 本地开发

```bash
pnpm install
pnpm contracts:build
pnpm architecture:check
pnpm infra:up
pnpm db:migrate
pnpm metrics:backfill
pnpm typecheck
pnpm test
pnpm test:integration
```

如果 Docker 使用非默认 Context：

```bash
DOCKER_CONTEXT=orbstack pnpm infra:up
```

`pnpm test:integration` 需要已执行迁移的 PostgreSQL 和 MinIO 开发环境，
用于真实验证筛选、Feedback 幂等、Review、运维健康、过期内容审计、指标汇总和
Dashboard 查询。

`pnpm metrics:backfill` 从 Trace 投影重建小时指标；可用 `--from` 和 `--to`
ISO 时间限制回填范围。

`pnpm metrics:load-test` 必须显式设置 `METRICS_LOAD_TEST_DATABASE_URL`，
并让 API 连接同一个一次性数据库，避免污染开发数据。

Python SDK：

```bash
uv sync --project packages/sdk-python --extra dev
uv run --project packages/sdk-python pytest -q
uv run --project packages/sdk-python mypy packages/sdk-python/src/agent_ops
```

启动平台：

```bash
pnpm dev
```

本地默认使用 `AGENT_OPS_AUTH_MODE=dev`。OIDC 模式需要
`.env.example` 中的 `OIDC_*` 配置；生产环境使用开发身份模式时服务端会拒绝启动。

通过 TypeScript 示例写入真实 Trace：

```bash
pnpm examples:ts
```

TypeScript 和 Python 的独立示例见 [examples/README.md](examples/README.md)。



