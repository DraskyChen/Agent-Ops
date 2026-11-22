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
- Dataset 和 Evaluation 控制台，支持创建修订、发起规则评测、自动刷新
  运行状态和查看逐用例结果。
- 管理员启用的 DeepSeek LLM Judge，固定结构化评分、外发确认、
  Prompt/响应审计、Token 用量和失败重试。
- 同一数据集修订、同一评测器版本的双运行对比，展示通过率、平均分、
  成本、P95 延迟和逐用例差值。
- 单团队生产 Compose、多阶段应用镜像、Nginx 反向代理和自动迁移服务；
  镜像实际构建仍需可访问 Docker Hub 的环境。
- 独立数据库中的每天 100 万 Span 写入、列表、宽泛搜索、详情和存储基线。
- 带 SHA-256 完整性校验的 PostgreSQL/MinIO 备份脚本、显式确认的完整恢复
  脚本，以及开发环境真实恢复演练。
- CI 质量/集成/镜像构建流水线、生产配置占位符检查、发布冒烟脚本和
  OIDC/SDK/备份/回滚运行手册。
- 独立的 PostgreSQL 和 MinIO 开发环境。

尚未完成：

- 容器构建与启动验收、30 天热数据/OTLP 并发压测、正式环境 RPO/RTO
  与异地备份验收、正式上线验收。

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

`pnpm capacity:test` 使用 `CAPACITY_TEST_DATABASE_URL` 对一次性数据库执行
Trace/Span 写入、列表、宽泛搜索和详情查询压测。默认目标为 100 万 Span，
测试数据会自动清理；结果与限制见 [容量基线](docs/capacity.md)。

备份与恢复命令：

```bash
pnpm backup
CONFIRM_RESTORE=yes pnpm restore /path/to/agent-ops-snapshot
```

恢复会停止应用并完整替换数据库和对象 Bucket。演练结果与生产要求见
[备份恢复演练](docs/backup-restore.md)。

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

## 单团队容器发布

复制并填写生产配置：

```bash
cp .env.production.example .env.production
```

生产配置使用 OIDC，必须设置 `AGENT_OPS_INGEST_TOKEN`、PostgreSQL 和
对象存储密钥。默认只暴露 Web 入口；SDK 应使用该入口下的
`https://<host>/v1/traces`。

```bash
pnpm release:config
pnpm release:build
pnpm release:up
docker compose --env-file .env.production \
  -f infra/docker-compose/compose.production.yaml ps
```

`migrate` 服务在 Server 和 Worker 启动前运行。Web 默认监听
`http://127.0.0.1:8080`，MinIO 管理端只绑定本机 `9001`。

本地默认使用 `AGENT_OPS_AUTH_MODE=dev`。OIDC 模式需要
`.env.example` 中的 `OIDC_*` 配置；生产环境使用开发身份模式时服务端会拒绝启动。

通过 TypeScript 示例写入真实 Trace：

```bash
pnpm examples:ts
```

TypeScript 和 Python 的独立示例见 [examples/README.md](examples/README.md)。



