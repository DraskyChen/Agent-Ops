# Agent Ops SDK 示例

这些示例演示一个已有 Agent 如何接入 Agent Ops SDK。模型和工具调用使用带延迟的本地模拟，不会请求外部模型 API。

## 启动依赖

```bash
pnpm infra:up
pnpm db:migrate
pnpm dev
```

如果本机 Docker 使用非默认 Context：

```bash
DOCKER_CONTEXT=orbstack pnpm infra:up
```

默认 OTLP 地址：

```text
http://127.0.0.1:4318/v1/traces
```

可以通过 `OTEL_EXPORTER_OTLP_ENDPOINT` 覆盖。

## TypeScript

运行全部示例：

```bash
pnpm examples:ts
```

`pnpm examples:ts` 只运行不需要密钥的模拟示例，不会自动调用 DeepSeek。

只运行一个示例：

```bash
pnpm --filter @agent-ops/example-typescript start:refund
pnpm --filter @agent-ops/example-typescript start:tool-failure
pnpm --filter @agent-ops/example-typescript start:retrieval
pnpm --filter @agent-ops/example-typescript start:multi-agent
```

| 示例 | 内容 |
| --- | --- |
| `refund` | Agent 运行、两次 LLM 调用、两个成功工具 |
| `tool-failure` | 工具超时、错误分类、失败后的恢复回复 |
| `retrieval` | RAG 检索、文档 ID、分数和生成调用 |
| `multi-agent` | 主 Agent、子 Agent、子 Agent 内的工具和 LLM |
| `deepseek` | 真实 DeepSeek API、真实 token 和 finish reason |

入口：[typescript/src/cli.ts](typescript/src/cli.ts)

## Python

同步环境：

```bash
uv sync --project examples/python
```

运行全部示例：

```bash
pnpm examples:python
```

也可以直接运行单个文件：

```bash
uv run --project examples/python python examples/python/refund.py
uv run --project examples/python python examples/python/tool_failure.py
uv run --project examples/python python examples/python/async_agent.py
```

| 示例 | 内容 |
| --- | --- |
| `refund.py` | 同步 Agent、LLM 和成功工具 |
| `tool_failure.py` | 同步工具异常和失败 Trace |
| `async_agent.py` | `asyncio` 下的 Agent、工具和 LLM Context 传播 |
| `deepseek.py` | 真实 DeepSeek API、真实 token 和 finish reason |

## DeepSeek

在仓库根目录创建 `.env`，不要提交到 Git：

```dotenv
DEEPSEEK_API_KEY=your-key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-flash
```

运行 TypeScript：

```bash
pnpm --filter @agent-ops/example-typescript start:deepseek
```

运行 Python：

```bash
uv run --project examples/python python examples/python/deepseek.py
```

DeepSeek 当前官方 OpenAI-compatible 模型名包括 `deepseek-flash` 和
`deepseek-v4-pro`。示例默认使用 `deepseek-flash`，可通过
`DEEPSEEK_MODEL` 覆盖。

价格与高峰/低峰规则见 [../docs/pricing.md](../docs/pricing.md)。

## 查看结果

打开：

```text
http://127.0.0.1:5173/console
```

点击 Refresh 后，可以看到新 Trace、执行树、token、费用、耗时、工具错误和已记录的输入输出摘要。

