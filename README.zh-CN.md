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
- PostgreSQL 持久化、Trace 聚合、Trace 列表和详情 API。
- 由 MinIO 支撑的服务端代理完整内容上传与读取。
- TypeScript 和 Python SDK 完整内容捕获及 Span `content_id` 关联。
- 由 `/api/v1/traces` 驱动的真实 Web 控制台。
- 独立的 PostgreSQL 和 MinIO 开发环境。

尚未完成：

- 评测、用户反馈和评分流程。

## 本地开发

```bash
pnpm install
pnpm contracts:generate
pnpm architecture:check
pnpm infra:up
pnpm db:migrate
pnpm typecheck
pnpm test
```

如果 Docker 使用非默认 Context：

```bash
DOCKER_CONTEXT=orbstack pnpm infra:up
```

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

通过 TypeScript 示例写入真实 Trace：

```bash
pnpm examples:ts
```

TypeScript 和 Python 的独立示例见 [examples/README.md](examples/README.md)。



