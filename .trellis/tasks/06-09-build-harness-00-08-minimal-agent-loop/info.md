# 00-08 知识点映射

## 当前实现目标

本篇把系统从“一次模型回答”推进到最小多步 Agent Loop。

核心不是无脑 `while true`，而是让模型判断、系统执行、observation 回填、状态继续推进，并在 final 或停止条件下可控结束。

## 代码映射

| 博客知识点 | 本篇代码位置 | 说明 |
| --- | --- | --- |
| `runAgentLoop()` | `src/runtime/run-agent-loop.ts` | 最小 loop 入口，只负责状态转换，不碰 HTTP、React 或 session 文件 |
| Think / Final | `collectAssistantDecision()` | 收集 provider stream，区分最终回答和工具意图 |
| Act / Tool Intent | `ToolIntent`、`ToolRegistry` | 模型只提出 intent，runtime 校验并执行 registry 中的工具 |
| Observe | `Observation`、`observationMessage()` | 工具结果整理成模型可见事实，作为下一轮输入 |
| State / newMessages | `RunAgentLoopResult.newMessages` | 只返回本轮新增消息，不改调用方原始 messages |
| Events | `AgentLoopEvent` | 记录关键 runtime 事实：turn、assistant、tool_intent、observation、final、stop |
| Stop Condition | `maxTurns`、`abortSignal` | 防止无限循环，并返回结构化停止原因 |
| Fake Tool | `createEchoTool()` | 用确定性工具验证 loop 机制，不接真实文件系统 |

## 本篇关键边界

- 不接真实文件系统。
- 不执行真实 shell 命令。
- 不做权限系统。
- 不做上下文压缩。
- 不做 session replay 或持久化 event log。
- 不让 provider 接管 loop、工具执行或停止条件。
- observation 暂时用普通 `user` message 回填，避免扩展 provider role 破坏现有 OpenAI message 映射。

## 最小验收路径

```text
用户目标
-> 模型提出 tool_intent
-> runtime 校验 intent
-> fake tool 执行
-> runtime 生成 observation
-> 下一轮模型看到 observation
-> 模型返回 final
```

## 测试映射

| 验收点 | 测试 |
| --- | --- |
| final 直接结束 | `runAgentLoop finishes when the model returns a final answer` |
| observation 影响下一轮 | `runAgentLoop feeds tool observation into the next model turn` |
| 未知工具不执行 | `runAgentLoop turns unknown tools into observations instead of executing them` |
| malformed intent 不执行 | `runAgentLoop turns malformed tool arguments into retryable observations` |
| maxTurns 可控停止 | `runAgentLoop stops at maxTurns after feeding the latest observation` |

## 后续文章预留

- `00-09` 会继续处理 provider 接入真实模型后，core 如何保持控制权。
- 后续 Tool Runtime 会把 `intent -> validate -> permission -> execute -> observe` 写厚。
- 后续 Context Policy 会决定哪些 observation 进入模型上下文，哪些只进入事件日志。
- 后续 Verification 会把“模型说完成”升级为“有验证证据完成”。
