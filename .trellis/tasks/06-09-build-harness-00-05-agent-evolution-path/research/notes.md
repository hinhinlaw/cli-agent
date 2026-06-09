# 00-05 研究笔记：Agent 演进路线

## 核心结论

Agent 不是一开始就被设计成复杂系统。它是在真实环境压力下，从 Chat 长到 Tool，从 Tool 长到 Runtime，从 Runtime 长到 Managed。

Harness 是这些控制责任的合体：模型负责判断下一步，Harness 负责让下一步在真实世界里更可控、可审计、可恢复、可验证地发生。

## 问题链

```text
Chat Agent 只管理 messages 和模型调用
-> 用户开始要求它“做事”，于是需要 Tool Agent
-> 工具让系统接触真实环境，也带来失败、成本和长任务
-> 于是需要 Runtime Agent 管预算、中断、错误恢复和 session log
-> 一旦系统要给多人、多个项目、多个环境使用
-> 就需要 Managed Agent 管 sandbox、permission、context policy、memory、eval、trace 和部署调度
-> 这些控制层合在一起，就是 Harness 的雏形
```

## 四阶段路线

| 阶段 | 解决的问题 | 新增压力 |
| --- | --- | --- |
| v0 Chat Agent | 如何让模型持续对话 | 容易把建议说成进展 |
| v1 Tool Agent | 如何让模型意图变成受控行动 | 工具结果要回填成事实 |
| v2/v3 Runtime Agent | 如何让长任务稳定运行 | 预算、错误、中断、恢复、上下文膨胀 |
| v4 Managed Agent | 如何让 Agent 被真实用户托管使用 | 多用户、多仓库、多权限、审计、eval、部署 |

这不是成熟度排行榜，而是风险压力模型。

## v0 Chat Agent

只管理 messages 和模型调用。

适合：

- 解释错误。
- 总结文件。
- 提供建议。

关键边界：不能把建议说成已经执行。

## v1 Tool Agent

让模型的意图变成受控行动。

新增对象：

- tool intent
- observation
- tool visibility

关键边界：工具结果必须作为事实回填，而不是混成自然语言总结。

## v2/v3 Runtime Agent

让长任务能被控制、恢复和复盘。

新增控制：

- budget
- interrupt
- error handling
- session log
- context policy
- resume checkpoint

关键边界：长任务不能只依赖内存 messages。

## v4 Managed Agent

让 Agent 进入真实组织和真实环境。

新增控制：

- sandbox
- audit
- trace
- eval
- deployment
- permission
- memory governance

关键边界：真实用户、多项目、多权限会把 demo 推向 Harness。

## 失败形态

不同阶段的失败应归因到不同层：

- Chat 阶段：模型回答把猜测当事实。
- Tool 阶段：工具结果没有变成 observation。
- Runtime 阶段：任务中断、上下文爆炸、重复动作。
- Managed 阶段：权限过宽、无法审计、无法回归。

## 可恢复、可评估、可委派

文章进一步强调三个高级压力：

- Session log：能恢复的事件账本。
- Sandbox：既是笼子，也是许可证。
- Eval flywheel：用 trace 改 Harness。
- Sub-agent handoff：委派时要传任务意图、已知事实、约束、工具、权限、预算、风险、中间工件、未决问题和返回格式。

Sub-agent 不是多叫几个模型角色扮演，而是工程责任的委派。

## 教学 Harness 的落地点

教学项目应按里程碑推进：

1. 先让 CLI/API 能回答。
2. 再让 `MockModel` 触发工具。
3. 再把工具结果写回 loop。
4. 再把 session 持久化。
5. 再用 UI 和事件线展示运行过程。

每一步只增加一种工程压力，不要一口气做 provider、权限、前端和持久化。
