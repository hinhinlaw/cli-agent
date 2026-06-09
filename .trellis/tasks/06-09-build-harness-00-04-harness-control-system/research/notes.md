# 00-04 研究笔记：Harness 控制回路

## 核心结论

模型负责判断，Harness 负责托管判断。

Agent 在循环中提出下一步，不等于它已经接触真实世界。下一步一旦进入真实环境，就需要模型外部的控制系统。

## 控制回路

Harness 的控制回路可以压成三步：

```text
约束：动作进入真实世界前，先经过边界控制。
反馈：真实执行结果必须变成可记录、可解释的 observation。
再投影：下一轮模型输入由 Harness 根据状态和策略重新装配。
```

这说明 Harness 既不是 prompt，也不是模型内部能力。

## Agent 与 Harness 的边界

Agent 的核心是动态判断和多步推进。

Harness 的核心是托管这个判断过程：

- 能不能执行。
- 在哪里执行。
- 如何记录。
- 如何恢复。
- 如何验证。
- 如何治理风险。

## Session、Harness、Sandbox

三者不能揉成一个对象：

- Session：一次任务运行的事实账本。
- Harness：托管 Agent 运行的控制系统。
- Sandbox：限制执行环境风险的边界。

Messages 不能等于 Session。Messages 是模型可见上下文；Session event log 是系统事实源。

## ETCLOVG 七层

### Execution

模型不能直接站在操作系统上。真实执行需要工作目录、进程、环境变量、超时、退出码和资源边界。

### Tools

工具不是普通函数，而是协议入口。工具需要 schema、可见性、校验、权限、执行、截断、observation 和审计。

### Context

模型每一轮看见什么，由 Harness 装配。Context 是从 state、session、workspace、memory 投影出的本轮输入，不等于全部状态。

### Lifecycle

长任务需要状态机。Harness 要处理开始、运行、暂停、恢复、中断、失败、完成。

### Observability

没有事实日志，就没有可改进的 Agent。Trace 应记录模型事件、工具意图、策略决策、执行结果、observation、状态更新。

### Verification

完成不是模型说了算。完成必须依赖验证证据，例如测试命令、退出码、报告或人工验收。

### Governance

Agent 越强，越需要边界。治理包括权限、审批、密钥、路径、网络、风险动作和组织规则。

## 事件对象

Harness 的专业性藏在事件对象里。

关键对象包括：

- `ModelEvent`
- `ToolIntent`
- `PolicyDecision`
- `ToolExecution`
- `Observation`
- `StateUpdate`
- `VerificationEvidence`

这些对象支持：

- 审计。
- 回放。
- 恢复。
- 失败归因。
- Eval。

如果只看最终答案，无法知道失败来自模型、工具、上下文、权限、执行环境还是验证策略。

## 教学 Harness 的落地点

教学项目里 Harness 不需要一开始很厚，但责任对象必须分开：

- Express API 负责请求编排。
- `runAgentLoop()` 负责状态转移。
- `ToolRegistry` 负责工具执行边界。
- `JsonlSessionStore` 负责事实记录。
- React UI 负责把消息和事件投影出来。

只要这些对象不互相吞并，后续扩权限、trace、resume 时就不需要重写核心。
