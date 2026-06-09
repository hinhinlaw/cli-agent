# 00-03 知识点映射

## 当前代码状态

本篇没有新增 Agent 代码。

原因：`00-03-chatbot-workflow-agent-harness.md` 是边界判断篇，目标是避免把所有自动化都误建模成 Agent。

## 后续实现约束

- 不确定性不在运行时，不进入 Agent Loop。
- 固定流程优先写成程序或测试，不交给模型动态判断。
- Agent 的工具调用必须产生事件，不允许只看最终回答。
- Harness 入口应能承载事件流、状态和验证证据。

## 概念到未来代码的预映射

| 博客知识点 | 未来代码位置 | 说明 |
| --- | --- | --- |
| ChatBot | prompt/debug entry | 一次模型调用或多轮对话 |
| Workflow | API handler / tests | 确定步骤由程序执行 |
| Agent | `runAgentLoop()` | 下一步取决于 observation |
| Harness | run/session API | 托管事件流、权限、状态和验证 |

## 本篇验收

- 已记录四类 LLM 应用边界。
- 已记录“不确定性在哪里”的判断规则。
- 已明确本篇不写代码。
