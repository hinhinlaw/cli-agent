# 00-01 研究笔记：Agent 基础定义

## 核心结论

本篇的核心判断是：Prompt 规定模型怎么说话，Agent 组织模型怎么做事，Harness 保证这件事能被控制。

这意味着学习和实现最小 Agent 时，不能从“写一个更长 system prompt”开始，而要从运行过程建模开始。

## 问题链

文章给出的演进链路是：

```text
一次 LLM 调用只能生成回答
-> 真实任务需要多步推进
-> 多步推进需要循环
-> 循环要接触外部世界，所以需要工具
-> 工具结果要影响下一步，所以需要状态
-> 状态、工具和循环一旦接触真实环境，就需要模型外部控制系统
-> Agent 从这里开始，Harness 则让这个过程走向可托管
```

这个链路决定后续实现顺序必须围绕运行系统展开，而不是围绕 prompt 堆规则。

## Prompt 与 Agent 的边界

Prompt 主要约束模型的生成侧：

- 模型是谁。
- 模型应该遵守什么规则。
- 模型应该用什么语气。
- 模型应该输出什么格式。

Prompt 不能承担四类工程责任：

- 事实源：区分用户输入、文件内容、工具观察和模型假设。
- 执行权：模型提出动作后，由系统实际执行。
- 验证权：用真实事件判断任务是否完成。
- 治理权：决定哪些动作允许、拒绝或需要用户确认。

## 模型输出不是现实动作

文章强调必须区分三件事：

```text
模型说了什么
系统做了什么
外部世界返回了什么
```

如果账本里没有真实的 `tool execution` 和 `observation`，只能说“模型声称它做过”，不能说“系统做过”。

最小事件链应包含：

```text
model event：模型提出行动
tool intent：Runtime 解析出结构化请求
tool execution：系统实际执行工具
observation：工具返回结果或错误
state update：结果被写回状态
```

## Agent Loop 的责任

Loop 让模型从一次回答变成多步推进：

```text
观察当前状态
-> 判断下一步
-> 产生行动意图
-> 系统执行行动
-> 把结果写回状态
-> 再进入下一轮判断
```

本篇给出的最小伪代码是：

```ts
while (!done) {
  const input = buildModelInput(state)
  const response = await callModel(input)
  const intent = parseResponse(response)

  if (intent.type === "final") {
    return intent.answer
  }

  const observation = await runTool(intent.tool, intent.args)
  state = appendObservation(state, response, observation)
}
```

关键不是 `while`，而是四个边界：

- `buildModelInput`：组织本轮模型输入。
- `parseResponse`：把模型输出解析为 final 或 tool intent。
- `runTool`：由系统执行真实动作。
- `appendObservation`：把外部结果写回状态。

## Tool 的边界

工具是 Harness 允许模型间接使用的受控能力，不是模型自己的手脚。

一个可控工具调用至少包含：

- 工具名。
- 参数 schema。
- 参数校验。
- 权限规则。
- 执行结果。
- 错误类型。
- 结果截断。
- 观察回填。
- 审计记录。

模型输出 tool call 只是请求执行，不等于动作已经执行。

## State 的边界

State 不是普通聊天记录，而是任务现场账本。它让下一轮模型不是从零开始。

最小 state 可以先是 messages，但长任务会自然扩展为：

- Conversation state：用户、模型、工具结果组成的消息历史。
- Runtime state：轮次、预算、中断信号、当前模式。
- Workspace state：已读文件、已改文件、当前 diff、测试结果。
- Decision state：计划、待确认动作、权限拒绝记录。
- Artifact state：报告、摘要、评估结果、可恢复 checkpoint。

## Harness 的边界

Harness 是 Agent 外面的控制系统，至少覆盖：

- 执行边界：工具、命令、路径、权限、沙箱。
- 事实边界：工具结果、事件日志、状态更新、验证证据。
- 生命周期边界：预算、超时、中断、恢复、完成条件。

后续完整 Harness 会继续扩展到：

- Execution
- Tools
- Context
- Lifecycle
- Observability
- Verification
- Governance

## 教学 Harness 的落地点

本篇最后给出的教学落地要求：

- prompt 只表达角色和边界。
- 行动交给 `runAgentLoop()` 与 `ToolRegistry`。
- 验收点是用户说“列出工作区文件”时，系统必须产生 assistant 的 `toolCall`、工具的 `toolResult`，再由 assistant 基于结果回答。

这条要求属于后续实现篇的方向提示；本篇本身不要求写代码。
