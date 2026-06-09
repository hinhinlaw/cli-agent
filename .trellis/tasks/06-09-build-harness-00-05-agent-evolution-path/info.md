# 00-05 知识点映射

## 当前代码状态

本篇没有新增 Agent 代码。

原因：`00-05-agent-evolution-path.md` 是路线图篇，目标是约束后续实现节奏：一阶段只增加一种工程压力。

## 后续实现约束

- 不一口气做成 Managed Agent 平台。
- 每个阶段必须能解释“新增能力”和“新增风险”。
- 工具、Runtime、Session、Permission、Eval 必须按博客顺序逐步长出。
- Eval 应基于 trajectory，而不是只看最终答案。

## 概念到未来代码的预映射

| 阶段 | 未来代码能力 | 说明 |
| --- | --- | --- |
| v0 Chat Agent | provider + messages | 让系统能回答 |
| v1 Tool Agent | tool intent + observation | 让模型意图变成受控行动 |
| v2/v3 Runtime Agent | budget + interrupt + session log | 让长任务可控和可恢复 |
| v4 Managed Agent | sandbox + trace + eval + deployment | 让 Agent 可托管 |

## 本篇验收

- 已记录四阶段演进路线。
- 已记录风险压力模型。
- 已记录教学里程碑推进原则。
