# Build Harness 00-08：Minimal Agent Loop

## Source

- Remote article: `https://raw.githubusercontent.com/LienJack/learn-agent/main/src/content/blog/zh/AI/build-harness/00-08-minimal-agent-loop.md`
- Title: `最小 Agent Loop：从单次回答到多步行动`
- Article date: `2026-05-29`

## Goal

实现最小 `runAgentLoop()`，让系统从单次模型回答进入受控的多步 Agent Loop：模型提出结构化 tool intent，runtime 验证并执行 fake tool，把 tool result 整理成 observation 回填给下一轮模型，直到模型返回 final 或触发停止条件。

## Deliverables

- 一个 provider-agnostic 的 `runAgentLoop()` core API。
- Loop 输入包含 `systemPrompt`、`messages`、`tools`、`model`、`toolRegistry` 和轮次预算。
- Loop 输出本次新增的 `newMessages` 与 `events`。
- 支持区分 assistant final 与 assistant tool intent。
- 支持 tool intent 验证、fake tool 执行、observation 回填。
- 支持 `maxTurns` 停止，并把停止原因体现在返回结果或事件里。
- 至少一个 fake tool 或 echo/fake test 工具，用于验证 observation 会影响下一轮模型判断。
- 测试覆盖 final 结束、工具调用后继续、invalid intent、maxTurns 停止。

## Out of Scope

- 不接真实文件系统。
- 不执行真实 shell 命令。
- 不做权限系统。
- 不做 HTTP、React、session 文件或持久化事件日志。
- 不做上下文压缩。
- 不做 provider-specific tool calling 协议。
- 不依赖真实模型跑测试。

## Acceptance Criteria

- `runAgentLoop()` 不知道 HTTP、React 或 session 文件。
- Tool result 会被整理为 observation message，并参与下一轮模型输入。
- 模型返回 final 时 loop 正常结束。
- 达到 `maxTurns` 时 loop 可控停止，不会无限循环。
- 模型提出未知工具或无效参数时，不直接执行；会产生 observation 或 stop event。
- Fake provider/fake model 测试不依赖外部网络或真实 API key。
