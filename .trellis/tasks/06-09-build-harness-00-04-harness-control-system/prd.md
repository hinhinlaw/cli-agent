# Build Harness 00-04：Harness 控制回路

## Source

- Local article: `/Applications/study/ai/learn-agent/src/content/blog/zh/AI/build-harness/00-04-harness-control-system.md`
- Title: `Harness 的控制回路：约束、反馈、再投影`
- Article date: `2026-05-29`

## Goal

理解 Harness 不是框架名，也不是更大的 Agent，而是模型外部的控制系统：通过约束、反馈、再投影托管模型判断。

## Scope

- 记录 Harness 的控制回路。
- 记录 ETCLOVG 七层职责：Execution、Tools、Context、Lifecycle、Observability、Verification、Governance。
- 记录 Session、Harness、Sandbox 的边界。
- 记录事件对象对 trace、replay、eval 的意义。

## Out of Scope

- 不实现 Express API。
- 不实现 `runAgentLoop()`。
- 不实现 `ToolRegistry`。
- 不实现 `JsonlSessionStore`。
- 不实现 React UI。

## Acceptance Criteria

- 已记录 Harness 七层控制责任。
- 已记录控制回路和事件对象边界。
- 已明确本篇不进入代码实现。
