# Build Harness 00-02：Agent 四个最小部件

## Source

- Local article: `/Applications/study/ai/learn-agent/src/content/blog/zh/AI/build-harness/00-02-agent-components.md`
- Title: `Agent 组成模型：Model、Loop、Tools、State`
- Article date: `2026-05-29`

## Goal

理解最小 Agent 的四条责任边界：`Model` 判断下一步，`Loop` 推动多步过程，`Tools` 通过受控协议接触真实世界，`State` 让过程不断线。

## Scope

- 记录 `Model / Loop / Tools / State` 的职责。
- 记录四个部件之间的单向数据流。
- 记录 `Runtime` 是四个部件之间的交通规则。
- 记录容易混淆的边界：Model/Agent、tool intent/tool execution、messages/state、loop/runtime。

## Out of Scope

- 不实现 `MockModel`。
- 不实现 `runAgentLoop()`。
- 不实现 `ToolRegistry`。
- 不实现 `JsonlSessionStore`。

## Acceptance Criteria

- 已记录四个最小部件的职责。
- 已记录后续代码模块的预映射。
- 已明确本篇仍是概念地图，不进入代码实现。
