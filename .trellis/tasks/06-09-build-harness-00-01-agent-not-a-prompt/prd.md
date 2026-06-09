# Build Harness 00-01：Agent 不是 Prompt

## Source

- Local article: `/Applications/study/ai/learn-agent/src/content/blog/zh/AI/build-harness/00-01-agent-not-a-prompt.md`
- Title: `Agent 基础定义：从回答到执行过程`
- Article date: `2026-05-29`

## Goal

理解本篇对 Agent 的最小定义：Agent 不是更长的 prompt，而是把模型、循环、工具和状态组织成一个可推进任务的运行过程；当该过程进入真实环境后，需要 Harness 提供外部控制。

## Scope

- 记录 Prompt、ChatBot、Agent、Harness 的职责边界。
- 记录 `Model`、`Loop`、`Tools`、`State` 四个最小 Agent 组成部分。
- 记录为什么模型输出不能等同于真实动作。
- 记录教学 Harness 的第一条落地方向。

## Out of Scope

- 不实现 TypeScript 代码。
- 不实现 `runAgentLoop()`。
- 不实现 `ToolRegistry`。
- 不接入 LLM Provider。
- 不设计完整 Harness 架构。

## Acceptance Criteria

- 已沉淀本篇核心知识点。
- 已明确本篇不写代码的原因。
- 已记录后续实现时必须遵守的工程边界：prompt 只表达角色和边界，行动交给 loop 与 tool runtime。
