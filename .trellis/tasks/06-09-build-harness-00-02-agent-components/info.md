# 00-02 知识点映射

## 当前代码状态

本篇没有新增 Agent 代码。

原因：`00-02-agent-components.md` 是组成模型篇，目标是把后续工程实现的责任地图画清楚。

## 后续实现约束

- Provider 只适配模型调用，不执行工具。
- Loop 只组织状态转移，不把权限、工具实现、session 持久化揉在一起。
- Tool Runtime 负责副作用边界。
- Session log 优先作为事实源，Context 只是投影，不是事实源。

## 概念到未来代码的预映射

| 博客知识点 | 未来代码位置 | 说明 |
| --- | --- | --- |
| Model | `model.ts` / `mockModel.ts` / provider | 统一模型输出为 message 或 tool intent |
| Loop | `loop.ts` | 推进 model -> intent -> tool -> observation -> state |
| Tools | `tools.ts` / `ToolRegistry` | 管理 schema、校验、执行和 observation |
| State | `sessionStore.ts` / event log | 保存事实事件并折叠成当前状态 |
| Runtime | runtime guardrails | 处理预算、中断、错误、权限和恢复 |

## 本篇验收

- 已记录四个最小部件。
- 已记录 Session log / State / Context / Memory 的边界。
- 已明确仍不写代码。
