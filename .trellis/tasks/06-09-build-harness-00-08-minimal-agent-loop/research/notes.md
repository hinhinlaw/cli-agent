# 00-08 研究笔记：最小 Agent Loop

## 核心结论

最小 Agent Loop 的价值不是让模型多说几轮，而是让真实 observation 改变下一轮判断。

一个能推进任务的 loop 至少要具备：

- 模型提出下一步 intent 或 final。
- 系统验证 intent。
- 工具由 runtime 受控执行。
- 工具结果整理成 observation。
- observation 回填到下一轮模型输入。
- loop 在 final、预算耗尽或中断时可控停止。

## 单次回答的瓶颈

对于“帮我看看测试为什么失败，并把它修好”这类任务，单次模型调用只能给建议，不能获取真实项目事实。

缺失事实包括：

- 项目用什么包管理器。
- 测试命令是什么。
- 失败日志是什么。
- 失败测试和相关源码在哪里。
- 修改后是否真的通过。

Agent Loop 要补上的断裂是：

```text
模型判断下一步
-> 系统执行受控动作
-> 真实观察写回 state
-> 模型基于新观察继续判断
-> final 或 stop condition
```

## Loop 是状态机，不是 while true

文章强调 loop 应该被理解为状态机，而不是无脑循环。

关键状态：

- `Thinking`：调用模型，得到 final 或 tool intent。
- `Acting`：runtime 执行工具，不让模型直接执行副作用。
- `Observing`：把 tool result 整理成模型可读 observation。
- `Finished`：模型给出 final。
- `Stopped`：达到预算、中断或失败边界。

工程含义：

- 工具失败不等于 loop 崩溃。
- 权限拒绝不等于模型继续猜。
- 超过最大轮次不等于任务成功。
- 模型说 final 不等于系统一定已经验证完成。

## 最小 ReAct 责任

这里的 ReAct 不是要求输出冗长思考过程，而是让判断、行动、观察、最终回答形成闭环。

最小责任链：

```text
buildQuery(state)
-> model.generate / provider.stream
-> parse response
-> final 或 tool intent
-> validate intent
-> execute tool
-> make observation
-> update state / budgets
```

纪律：

```text
模型提议下一步，
系统受控执行下一步，
状态记录下一步，
停止条件约束下一步。
```

## State 的边界

文章给出的最小 state 心智模型：

```ts
type AgentState = {
  messages: Message[]
  turnCount: number
  maxTurns: number
  aborted: boolean
  lastObservation?: Observation
  toolResults: ToolResult[]
  finalAnswer?: string
}
```

关键边界：

- `messages` 是模型可见上下文。
- `state` 是 runtime 当前现场。
- `event log` 是更完整的事实源。

最小实现可以先让它们很接近，但不能概念混淆。否则后续 context compression、session replay、trace analysis 会失去可靠事实源。

## 为什么先 fake tool

第 8 篇明确建议先不用真实文件系统、真实 shell 或真实编辑器。

先用 fake tool 是为了单独验证 loop 机制：

- 模型能否输出结构化 tool intent。
- runtime 能否区分 final 和 tool intent。
- intent 能否进入执行器。
- tool result 能否变成 observation。
- observation 能否影响下一轮输入。
- final 和 maxTurns 能否停止 loop。

这样能把问题拆开，避免第一版就混入路径权限、文件长度、命令输出、编辑 diff 等复杂变量。

## Observation 的角色

Observation 不是原始 stdout 的复制，而是“工具执行结果的模型可读摘要 + 必要证据”。

建议形态：

```ts
type Observation = {
  toolName: string
  ok: boolean
  summary: string
  evidence?: string
  errorType?: string
  retryable?: boolean
}
```

Observation 要回答下一轮模型真正需要知道的事实：

- 工具是否成功。
- 发生了什么。
- 关键证据是什么。
- 失败是否可重试。

当前实现选择：

- observation 暂时投影成普通 `user` message。
- 内容以 `Observation:` 开头。
- 不新增 provider role，避免破坏现有 `OpenAIProvider` 的 message 映射。

## 停止条件

最小 Agent Loop 至少要支持：

- 模型返回 final。
- 超过最大轮次。
- 预算耗尽。
- 外部中断。
- 致命错误或连续无效 intent。

本篇实现先覆盖：

- `final`
- `maxTurns`
- `abortSignal`
- unknown tool observation
- invalid tool intent observation

后续预算、timeout、连续无效 intent limit 可以在同一状态机上扩展。

## 本章代码落点

文章明确落点：

```text
runAgentLoop()
```

输入：

- `systemPrompt`
- `messages`
- `tools`
- `model`
- `toolRegistry`

输出：

- `newMessages`
- `events`

边界：

- 不知道 HTTP。
- 不知道 React。
- 不知道 session 文件。
- 只负责在 `maxTurns` 内完成 `assistant -> toolResult -> assistant` 的状态转换。
- 在每个关键点 emit event。

## 当前代码映射

| 文章概念 | 当前代码 |
| --- | --- |
| `runAgentLoop()` | `src/runtime/run-agent-loop.ts` |
| Model / Provider | `LlmProvider.stream()` |
| Tool Intent | `ModelEvent.type === "tool_intent"` -> `ToolIntent` |
| Tool Registry | `ToolRegistry` |
| Fake Tool | `createEchoTool()` |
| Observation | `Observation` + `observationMessage()` |
| State Projection | `buildLoopMessages()` |
| Events | `AgentLoopEvent` |
| Stop Condition | `maxTurns` / `abortSignal` |

## 测试策略

测试必须用 fake provider / fake tool，不依赖网络或 API key。

已覆盖路径：

- final 直接结束。
- tool intent -> fake tool -> observation -> 下一轮 final。
- unknown tool 不执行，转成 failed observation。
- malformed tool arguments 不执行，转成 retryable observation。
- maxTurns 在 observation 回填后停止。

## 关键坏味道

### 只有 Act，没有 Observe

能执行工具，但下一轮模型看不到结构化结果。表现为模型反复请求同一个文件或同一个命令。

修法：tool result 必须整理成 observation 并回填。

### 只有 Continue，没有 Stop

只要有工具调用就继续，没有最大轮次、预算、中断或失败退出。

修法：stop reason 是一等结果，不是异常逃逸。

### 只有 Messages，没有 State

所有事实都塞进 messages，没有 runtime 自己的状态。

修法：区分模型上下文、runtime state、event log。

## 后续章节连接

- `00-09`：真实 provider 接进 loop 后，core 不能被 provider 细节接管。
- Tool Runtime：把 `intent -> validate -> permission -> execute -> observe` 写完整。
- Context Policy：治理哪些 observation 进入 prompt，哪些只进 event log。
- Verification：final 不能只听模型自称完成，必须能挂验证证据。
- Harness：负责中断、恢复、审计、回放和更长生命周期。
