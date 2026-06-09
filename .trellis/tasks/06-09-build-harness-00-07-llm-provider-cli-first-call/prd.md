# Build Harness 00-07：LLM Provider CLI First Call

## Source

- Local article: `/Applications/study/ai/learn-agent/src/content/blog/zh/AI/build-harness/00-07-llm-provider-cli-first-call.md`
- Title: `LLM Provider 接入：让 CLI 完成第一次模型调用`
- Article date: `2026-05-29`

## Goal

实现第一篇实战交付：让 CLI 完成第一次模型调用，同时建立 provider contract，避免 provider 细节污染后续 Agent core。

## Deliverables

- 一个可运行 CLI：用户能输入一句话，模型能流式输出回答。
- 一个 provider contract：core 只依赖 `LlmProvider`、`ChatRequest`、`ModelEvent`、`ProviderError`。
- 至少一个真实 provider adapter：把内部请求翻译成某家 API，再把响应翻译回统一事件。
- 一个 fake provider：让 runtime 测试不依赖真实模型。

## Out of Scope

- 不做 Agent Loop。
- 不执行工具。
- 不做上下文压缩。
- 不做自动重试策略。
- 不做 provider fallback。
- 不做 session replay。

## Acceptance Criteria

- CLI 能流式输出。
- Fake provider 能跑测试。
- 真实 provider 错误会映射成结构化错误。
- API Key、base URL、header 不进入 messages、event log 或模型上下文。
