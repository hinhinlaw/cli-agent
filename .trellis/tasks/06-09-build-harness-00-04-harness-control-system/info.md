# 00-04 知识点映射

## 当前代码状态

本篇没有新增 Agent 代码。

原因：`00-04-harness-control-system.md` 是 Harness 控制系统篇，目标是定义模型外部控制责任。

## 后续实现约束

- Messages 不能作为唯一事实源。
- Session event log 必须优先于压缩后的 context。
- 完成判断必须依赖 `VerificationEvidence`。
- Tool 执行必须经过策略决策和事件记录。
- Sandbox 是执行边界，不是 Harness 的全部。

## 概念到未来代码的预映射

| 博客知识点 | 未来代码位置 | 说明 |
| --- | --- | --- |
| Execution | command runner / shell tool | 管理工作目录、超时、退出码、环境 |
| Tools | `ToolRegistry` | 管理工具协议入口 |
| Context | context builder | 从 state 投影模型输入 |
| Lifecycle | runtime state machine | 处理 run 状态、暂停、恢复、中断 |
| Observability | trace / event log | 记录完整事件链 |
| Verification | verification gate | 禁止模型空口宣布完成 |
| Governance | permission policy | 管理风险动作和审批 |

## 本篇验收

- 已记录 ETCLOVG 七层。
- 已记录 Session / Harness / Sandbox 边界。
- 已记录事件对象的意义。
