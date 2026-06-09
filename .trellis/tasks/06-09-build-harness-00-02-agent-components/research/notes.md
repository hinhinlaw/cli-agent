# 00-02 研究笔记：Model、Loop、Tools、State

## 核心结论

Agent 的最小闭环是：`Model` 判断，`Loop` 推进，`Tools` 行动，`State` 续上下一轮。

这四个词不是模块名装饰，而是四条必须分开的工程责任边界。

## 问题链

```text
只有模型，系统只能回答，不能行动
-> 加上 loop，系统可以多步推进，但每一步仍然只能空想
-> 加上 tools，系统可以接触真实项目，但行动需要被记录
-> 加上 state，模型能基于历史继续判断，但状态会膨胀、过期、污染
-> 所以还需要 runtime 和 harness，把四个部件组织成可控系统
```

## Model

Model 的职责是判断下一步，不负责执行。

必须守住的边界：

- Provider 不执行工具。
- Provider 不管理任务世界。
- Provider 不直接修改状态。
- 模型输出是判断结果或行动意图，不是事实本身。

后续会自然长出 `Provider Runtime`，用于适配不同模型 API。

## Loop

Loop 的职责是把一次判断变成多步过程。

Loop 负责：

- 构造本轮输入。
- 调用 model。
- 解析 final 或 tool intent。
- 推进工具执行。
- 把 observation 写回 state。
- 判断是否继续或停止。

Loop 不应该吞掉所有运行规则。预算、中断、错误、权限和恢复会把 Loop 推向更完整的 Runtime。

## Tools

Tools 的职责是把“想做”变成“能做”。

Tool call 更准确地说是 `tool intent`。真正执行前还需要：

- validate
- authorize
- execute
- observe
- record

工具不是模型的手脚，而是 Harness 暴露给模型间接使用的受控协议入口。

## State

State 的职责是让过程不断线。

Messages 只是 State 的一部分。完整 State 还会包含：

- 工具结果。
- 当前轮次。
- 预算。
- 已读/已改文件。
- 错误和审批状态。
- artifacts。

本篇还区分了四个易混概念：

```text
Session log：事件事实源，记录发生过什么。
State：从事件折叠出的当前任务现场。
Context：本轮投影给模型看的信息。
Memory：跨任务可检索的经验和长期事实。
```

优先级判断：如果只能先做好一个，优先做好 Session log，因为它是后续 state、context、memory 的事实源。

## Runtime

Runtime 是四个部件之间的交通规则。

它回答：

- 每轮怎么开始和结束。
- 工具失败怎么处理。
- observation 怎么写回。
- 预算耗尽怎么停止。
- 权限审批如何暂停 loop。

Runtime 继续往外扩，会逐渐长成 Harness。

## 教学 Harness 的落地点

本篇给出的教学映射：

- `MockModel` 代表 Model。
- `runAgentLoop()` 代表 Loop。
- `ToolRegistry` 代表 Tools。
- `JsonlSessionStore` 代表 State。

关键不是名字一一对应，而是数据流单向清楚：model 只能生成 message 或 tool intent，loop 负责推进，tool runtime 负责副作用，store 负责从历史构造下一轮 context。
