# 00-01 知识点映射

## 当前代码状态

本篇没有新增 Agent 代码。

原因：`00-01-agent-not-a-prompt.md` 是概念定义篇，目标是建立 Prompt、Agent、Harness 的责任边界。文章明确先回答“构建 Agent 比写 prompt 多构建了什么”，而不是开始实现模块。

## 后续实现约束

后续进入实现篇时，必须遵守以下边界：

- Prompt 只负责角色、规则、输出边界。
- 模型输出只能视为 `Model Event`，不能视为真实动作。
- 工具调用必须经过 `Tool Intent -> Policy Decision -> Tool Execution -> Observation -> State Update`。
- 真实动作必须由 Runtime / Harness 执行并记录。
- 完成判断必须依赖验证事件，而不是模型总结。

## 概念到未来代码的预映射

| 博客知识点 | 未来代码位置 | 说明 |
| --- | --- | --- |
| Model 负责判断下一步 | LLM Provider / model client | 封装模型调用，不直接接触真实环境 |
| Loop 是心跳 | `runAgentLoop()` | 组织 model -> intent -> tool -> observation -> state |
| Tools 是受控能力 | `ToolRegistry` / tool runtime | 定义工具 schema、校验、执行、回填 |
| State 是现场账本 | messages / runtime state | 保存用户目标、模型事件、工具结果、预算等 |
| Harness 是外部控制系统 | permission / trace / eval / lifecycle | 管理权限、日志、验证、恢复和治理 |

## 本篇验收

- 已记录 Agent 不是 Prompt 的原因。
- 已记录最小 Agent 的四个组成：Model、Loop、Tools、State。
- 已记录 Harness 的控制边界。
- 已明确当前阶段不写代码。
