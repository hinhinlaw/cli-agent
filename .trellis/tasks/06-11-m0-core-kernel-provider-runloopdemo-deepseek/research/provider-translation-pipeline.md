# Provider 翻译链路：真实模型响应 → 系统内部语言

> 对应博客：[00-09-m0-core-kernel.md](https://github.com/LienJack/build-harness/blob/main/docs/zh/00-09-m0-core-kernel.md)
>
> 核心命题：**Provider 把外部 API 翻译成 ModelEvent，Runtime 把 ModelEvent 变成 RuntimeEvent + RuntimeOutput。Provider 不能直接改 state，不能直接执行工具。**

---

## 一、两层内部语言

系统定义了两层 contract，每一层有明确的职责边界：

| 层 | 类型 | 定义文件 | 职责 |
|---|---|---|---|
| Provider 适配层 | `ModelEvent` | `src/providers/contract.ts` | 屏蔽不同模型 API 的格式差异 |
| Runtime 控制层 | `RuntimeEvent` | `src/runtime/contracts.ts` | 记录事实、驱动状态、产出用户界面 |

博客的核心论断：

> 不是让 core 适配 provider。而是让 provider 适配 core。

---

## 二、完整数据流

```
DeepSeek/OpenAI 原始 SSE 响应（外部协议）
        │
        ▼
   OpenAIProvider.stream()          ← 第一层翻译
   (src/providers/openai.ts:93)       外部协议 → ModelEvent
        │
        ▼
   ModelEvent stream                ← Provider 层的"内部语言"
   (src/providers/contract.ts:38)     只描述模型行为，不涉及执行
        │
        ▼
   AgentRuntime.send()              ← 第二层翻译
   (src/runtime/agent-runtime.ts:33)  ModelEvent → RuntimeEvent + RuntimeOutput
        │
        ├──→ EventBus               ← RuntimeEvent 写入事实日志
        │    (src/runtime/event-bus.ts)  State 从这些事件折叠出来
        │
        └──→ RuntimeOutput → CLI     ← 用户看到的东西
             (src/runtime/contracts.ts:37)
```

---

## 三、第一层翻译：OpenAIProvider — 外部协议 → ModelEvent

**博客对应章节**：四、Provider：外部协议翻译层

**代码入口**：`src/providers/openai.ts:93-183` — `stream()` 方法

**翻译映射表**：

| 原始 SSE 内容 | 翻译后的 ModelEvent | 代码位置 |
|---|---|---|
| `delta.content` 有文本 | `{ type: "text_delta", text: "..." }` | `openai.ts:150-152` |
| `delta.tool_calls` 有工具调用 | 按 index/id 分片拼接，最后产出 `{ type: "tool_intent", name, argumentsText }` | `openai.ts:154-165` |
| `finish_reason` + `usage` | `{ type: "message_stop", stopReason, usage }` | `openai.ts:167-168` |
| HTTP 错误响应 | `{ type: "error", error: { kind, retryable, ... } }` | `openai.ts:102-104` |

**关键设计决策**：

1. **Tool call 分片拼接**（`openai.ts:124-165`）：DeepSeek/OpenAI 的 tool call 参数可能分多个 chunk 返回，Provider 层负责在内存中拼成完整的 `argumentsText` 后才产出 `tool_intent` 事件。

2. **错误归一化**（`openai.ts:214-224`）：不同 HTTP 状态码被映射成统一的 `ProviderError`，含 `kind`（auth / rate_limit / server 等）和 `retryable` 标记。外部协议差异不泄漏到 Runtime 层。

3. **Base URL 可配置**（`openai.ts:59-60` + `load-provider-config.ts:34-36`）：通过 `LLM_BASE_URL` 环境变量切换模型服务商（OpenAI / DeepSeek / 代理），无需改代码。

---

## 四、第二层翻译：AgentRuntime — ModelEvent → RuntimeEvent + RuntimeOutput

**博客对应章节**：六、Event Bus / 七、Conversation State / 八、Runtime Facade

**代码入口**：`src/runtime/agent-runtime.ts:33-103` — `send()` 方法

**ModelEvent → RuntimeEvent 映射**：

| ModelEvent | 写入 EventBus 的 RuntimeEvent | 代码位置 |
|---|---|---|
| `text_delta` | `{ type: "model.text.delta", runId, text }` | `agent-runtime.ts:58` |
| `tool_intent` | `{ type: "model.tool.intent", runId, intent: ToolIntent }` | `agent-runtime.ts:71` |
| `message_stop` (有 tool) | `{ type: "run.finished", status: "waiting_for_tool" }` | `agent-runtime.ts:81` |
| `message_stop` (无 tool) | `{ type: "model.final" }` + `{ type: "run.finished", status: "completed" }` | `agent-runtime.ts:85-86` |
| `error` | `{ type: "runtime.error" }` + `{ type: "run.finished", status: "failed" }` | `agent-runtime.ts:92-93` |

**ModelEvent → RuntimeOutput（给 CLI）映射**：

| ModelEvent | 产出的 RuntimeOutput | 代码位置 |
|---|---|---|
| `text_delta` | `{ type: "text.delta", text }` | `agent-runtime.ts:59` |
| `tool_intent` | `{ type: "tool.intent", intent }` | `agent-runtime.ts:72` |
| `message_stop` | `{ type: "status", status: "waiting_for_tool" \| "completed" }` | `agent-runtime.ts:82,87` |
| `error` | `{ type: "error", error }` | `agent-runtime.ts:94` |

**关键设计决策**：

1. **ToolIntent 不等于 ToolExecution**（`agent-runtime.ts:62-73`）：
   - 模型提出的 tool intent 被解析成结构化的 `ToolIntent`（含系统生成的 `intentId`）
   - Provider 的原始 tool call id 只放在 `providerRef.rawId` 里，不作为系统事实源
   - Runtime 状态变为 `waiting_for_tool`，**不自动执行**
   - 博客："ToolIntent 只是系统内的一张申请单"

2. **tools 来自 Registry**（`agent-runtime.ts:30` + `tool-registry.ts`）：
   - 工具描述从 `ToolRegistry` 投影到 provider request
   - 博客："模型看到的工具 schema，只是 registry 的投影"

3. **EventBus 是 append-only log**（`event-bus.ts`）：
   - 所有事实先进入事件流，State 从事件流折叠出来
   - 博客："所有重要事实先进入事件流。State 从事件流折叠出来。"

---

## 五、State 重建：从事件折叠出现场

**博客对应章节**：七、Conversation State：从事件折叠出现场

**代码**：`src/runtime/conversation-state.ts` — `reduceConversationState()`

```typescript
function reduceConversationState(events: readonly RuntimeEvent[]): ConversationState {
  // 遍历事件列表，用 switch 对每种事件做 reducer
  // "model.text.delta" → 拼到 assistant draft
  // "model.tool.intent"  → 推入 pendingToolIntents，状态变 waiting_for_tool
  // "model.final"        → flush draft，状态变 completed
  // "run.finished"       → 状态来自事件而非内存变量
  // "runtime.error"      → 记录 lastError，状态变 failed
}
```

**博客测试用例的代码对应**：

| 博客测试 | 对应实际测试 | 测试文件 |
|---|---|---|
| `records tool intent without executing it` | `AgentRuntime records tool intent without executing tools` | `agent-runtime.test.ts:34` |
| `rebuilds conversation state from events` | `reduceConversationState rebuilds pending tool state from events` | `agent-runtime.test.ts:86` |

---

## 六、具体例子走一遍

用户输入 `"帮我修复测试"`，接 DeepSeek 模型，完整链路：

```
1. AgentRuntime.send() 先写事件:
   → EventBus: { type: "user.message", runId: "r1", text: "帮我修复测试" }
   → EventBus: { type: "run.started", runId: "r1" }
   → CLI:     { type: "status", status: "running" }

2. buildRequest() 构建 ChatRequest（含 registry 投影的工具描述）→ 发给 DeepSeek

3. DeepSeek 返回 SSE chunks（外部协议）

4. OpenAIProvider.stream() 翻译 → ModelEvent:
   { type: "message_start" }
   { type: "text_delta", text: "我需要先运行测试。" }
   { type: "tool_intent", name: "run_tests", argumentsText: '{"command":"npm test"}' }
   { type: "message_stop", stopReason: "tool_use", usage: {...} }

5. AgentRuntime 消费 ModelEvent:
   → EventBus: { type: "model.text.delta", runId: "r1", text: "我需要先运行测试。" }
   → CLI:     { type: "text.delta", text: "我需要先运行测试。" }
   → EventBus: { type: "model.tool.intent", runId: "r1", intent: {...} }
   → CLI:     { type: "tool.intent", intent: {...} }
   → EventBus: { type: "run.finished", status: "waiting_for_tool" }
   → CLI:     { type: "status", status: "waiting_for_tool" }

6. reduceConversationState(eventBus.snapshot()):
   { status: "waiting_for_tool", pendingToolIntents: [{ toolName: "run_tests", ... }], ... }
```

---

## 七、博客概念 → 代码文件速查

| 博客概念 | 代码文件 | 关键函数/类型 |
|---|---|---|
| Contracts（内部语言） | `src/providers/contract.ts` | `ModelEvent`, `ChatRequest`, `LlmProvider` |
| Contracts（运行时） | `src/runtime/contracts.ts` | `RuntimeEvent`, `RuntimeOutput`, `ToolIntent`, `ConversationState` |
| Provider 适配层 | `src/providers/openai.ts` | `OpenAIProvider.stream()` |
| Provider 配置 | `src/config/load-provider-config.ts` | `loadProviderConfig()` |
| Registry | `src/runtime/tool-registry.ts` | `ToolRegistry` |
| Event Bus | `src/runtime/event-bus.ts` | `EventBus` |
| Conversation State | `src/runtime/conversation-state.ts` | `reduceConversationState()` |
| Runtime Facade | `src/runtime/agent-runtime.ts` | `AgentRuntime.send()` |
| CLI 入口 | `src/cli/main.ts` | `main()`, `runLoopDemo()` |
