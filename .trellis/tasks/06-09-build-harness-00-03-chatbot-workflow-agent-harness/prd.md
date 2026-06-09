# Build Harness 00-03：ChatBot、Workflow、Agent、Harness 边界

## Source

- Local article: `/Applications/study/ai/learn-agent/src/content/blog/zh/AI/build-harness/00-03-chatbot-workflow-agent-harness.md`
- Title: `系统边界：ChatBot、Workflow、Agent、Harness 的区别`
- Article date: `2026-05-29`

## Goal

理解四类 LLM 应用的边界：ChatBot 解决对话问题，Workflow 解决确定流程问题，Agent 解决动态决策问题，Harness 解决稳定托管问题。

## Scope

- 记录四类系统形态的职责和适用条件。
- 记录“不确定性在哪里”是选择边界的核心问题。
- 记录 Agent 不是默认升级方向，而是为动态不确定性付出的复杂度成本。
- 记录教学项目里的入口边界。

## Out of Scope

- 不实现 API。
- 不实现 `/api/prompt`。
- 不实现 `/api/runs`。
- 不实现事件流。

## Acceptance Criteria

- 已记录四类系统边界。
- 已记录边界判断规则。
- 已明确本篇不进入代码实现。
