# 代码流追踪：以 "请帮我运行 npm run test:sum并修复报错" 为例

> 基于真实运行日志 `docs/agent运行日志.md`（2026-06-12 成功运行），逐行追踪代码流。
>
> 参考日志中的 event log：从 `[user]` 到 `[run_finished] completed`，共 18 次工具调用 + 3 次模型文字输出。

---

## 零、整体架构速览

```
main.ts                         agent-runtime.ts              openai.ts
──────                          ────────────────              ────────
runLoopDemo()                   AgentRuntime.send()           OpenAIProvider.stream()
  ↓                               ↓                             ↓
  for await (event                while (true) {                for await (chunk
    of runtime.send())  ← yield ──  for await (event    ← yield ──  of readSSE())
  {                                of provider.stream())        {
    print(event);                    {                            yield modelEvent;
  }                                    yield runtimeOutput;     }
                                     }
                                     // tool execution
                                     // rebuild messages
                                   }
```

**三个概念对应的变量**（`agent-runtime.ts`）：

| 概念 | 变量 | 类型 |
|---|---|---|
| Event Log | `this.eventBus` | `EventBus`（内部存 `RuntimeEvent[]`） |
| Conversation State | `updatedState`（局部变量） | `ConversationState` |
| Context（上下文） | `messages`（闭包变量） | `ChatMessage[]` |

---

## 一、Phase 1：CLI 入口 — main.ts → runLoopDemo()

```
用户输入命令行:
LLM_PROVIDER=openai LLM_BASE_URL=https://api.deepseek.com LLM_MODEL=deepseek-v4-pro \
OPENAI_API_KEY=sk-xxx npm run dev -- --loop "请帮我运行 npm run test:sum并修复报错"
```

### 1.1 `main()` 解析参数 (`main.ts:21-22`)

```
parseArgs(["--loop", "请帮我运行 npm run test:sum并修复报错"])
  → { loop: true, promptArgs: ["请帮我运行 npm run test:sum并修复报错"] }
```

因为 `parsedArgs.loop === true`，进入 `runLoopDemo()`（`main.ts:24`）。

### 1.2 `runLoopDemo()` 组装 Runtime (`main.ts:52-72`)

```typescript
// main.ts:60-71
const executors: ToolExecutor[] = [bashExecutor, readFileExecutor, editFileExecutor];
const config = loadProviderConfig(process.env);
//   → { provider: OpenAIProvider, model: "deepseek-v4-pro" }

const runtime = new AgentRuntime({
  provider: config.provider,    // OpenAIProvider 实例
  model: config.model,          // "deepseek-v4-pro"
  systemPrompt: SYSTEM_PROMPT,  // 强化版 System Prompt（6条规则）
  tools: realM0Tools,           // bash, read_file, edit_file 的工具定义
  toolExecutors: executors,     // 对应的 executor 实现
  approver: cliApprover,        // read_file 自动放行，其他需确认
});
```

### 1.3 `AgentRuntime` 构造函数 (`agent-runtime.ts:44-55`)

```
构造过程:
  1. this.eventBus = new EventBus()
  2. this.toolRegistry = new ToolRegistry(realM0Tools)
     → 注册 bash, read_file, edit_file
  3. this.executorMap = Map { "bash" → bashExecutor, "read_file" → ..., "edit_file" → ... }
  4. this.approver = cliApprover
```

### 1.4 进入 send() — 多轮循环入口 (`main.ts:73`)

```typescript
for await (const event of runtime.send({ text: "请帮我运行 npm run test:sum并修复报错" })) {
  printRuntimeOutput(event);  // 实时打印 text.delta / tool.intent / status / error
}
```

---

## 二、Phase 2：`AgentRuntime.send()` 的第 0 轮（初始化）

### 2.1 写入初始事件 (`agent-runtime.ts:57-61`)

```typescript
async *send(input: UserInput): AsyncIterable<RuntimeOutput> {
  const runId = randomUUID();  // "ab73f5af-..."
  this.eventBus.append({ type: "user.message", runId, text: input.text });
  this.eventBus.append({ type: "run.started", runId });
  yield { type: "status", status: "running" };  // → CLI 打印 "status: running"
}
```

对应日志：
```
[user] 请帮我运行 npm run test:sum并修复报错       ← user.message 事件
[run_started] run id: ab73f5af-b2e2-4c02-aa49-c033728b7bdb  ← run.started 事件
```

### 2.2 构建初始 Context (`agent-runtime.ts:64` + `300-310`)

```typescript
const messages = this.buildInitialMessages("请帮我运行 npm run test:sum并修复报错");
// 结果:
// [
//   { role: "system", content: "你是一个 CLI 编程助手。重要规则：\n1. 当你需要执行操作时..." },
//   { role: "user",   content: "请帮我运行 npm run test:sum并修复报错" }
// ]
```

### 2.3 executorMap.size > 0 → 进入多轮循环 (`agent-runtime.ts:67-70`)

```typescript
if (this.executorMap.size === 0) {
  yield* this.singleTurnSend(runId, messages);  // 不走这条路
  return;
}
// executorMap 有 3 个 executor，所以进入 while(true) 多轮循环
```

---

## 三、Phase 3：第 1 轮 — 调用 LLM，三层 for...of 流式消费

### 3.1 构建 ChatRequest (`agent-runtime.ts:74-82`)

```typescript
const request: ChatRequest = {
  model: "deepseek-v4-pro",
  messages: [
    { role: "system", content: "..." },
    { role: "user", content: "请帮我运行 npm run test:sum并修复报错" }
  ],
  tools: [
    { name: "bash", description: "Execute a shell command...", inputSchema: {...} },
    { name: "read_file", description: "Read a file...", inputSchema: {...} },
    { name: "edit_file", description: "Apply an edit...", inputSchema: {...} }
  ],
  temperature: undefined,
  maxOutputTokens: undefined,
  abortSignal: undefined,
  metadata: { sessionId: runId, turnId: runId }
};
```

### 3.2 进入三层 for...of (`agent-runtime.ts:89`)

```typescript
for await (const event of this.args.provider.stream(request)) {
  //   ^^^^^ 第 2 层 ^^^^^              ^^^^^^ 第 1 层 ^^^^^^
```

#### 第 1 层（最底层）：`readServerSentEvents()` (`openai.ts:258-294`)

```
HTTP response.body（字节流）
  → reader.read() 每次读一个 chunk
  → 按 "\n\n" 分割成 SSE messages
  → 解析 "data: ..." 行
  → yield 原始 JSON 字符串
```

例如 DeepSeek 返回 `data: {"choices":[{"delta":{"content":"我"}}]}\n\n`，yield 出 `{"choices":[{"delta":{"content":"我"}}]}`。

#### 第 2 层（中间层）：`OpenAIProvider.stream()` (`openai.ts:93-183`)

```typescript
async *stream(request: ChatRequest): AsyncIterable<ModelEvent> {
  for await (const chunk of readServerSentEvents(response.body)) {
    // chunk = '{"choices":[{"delta":{"content":"我"}}]}'
    const event = parseOpenAIChunk(chunk);
    for (const choice of event.choices ?? []) {
      if (choice.delta?.content) {
        yield { type: "text_delta", text: choice.delta.content };  // 第 1 次 yield
      }
      // 如果有 tool_calls，拼接到 toolCallFragments Map 中
    }
  }
  // 所有 chunk 处理完后，遍历 toolCallFragments，yield tool_intent  events
  for (const toolCall of toolCallFragments.values()) {
    yield { type: "tool_intent", id: ..., name: "bash", argumentsText: "{\"command\":\"npm run test:sum\"}" };
  }
  yield { type: "message_stop", usage: {...}, stopReason: "tool_use" };
}
```

**每 yield 一次 ModelEvent，控制权回到 `agent-runtime.ts:89` 的 `for await`**。

#### 第 3 层（最外层）：`AgentRuntime.send()` (`agent-runtime.ts:89-191`)

```typescript
for await (const event of this.args.provider.stream(request)) {
  switch (event.type) {
    case "text_delta":
      text += event.text;
      this.eventBus.append({ type: "model.text.delta", runId, text: event.text });
      yield { type: "text.delta", text: event.text };  // 第 3 次 yield → CLI
      break;

    case "tool_intent":
      sawToolIntent = true;
      lastIntent = toToolIntent(event, "openai").intent;
      this.eventBus.append({ type: "model.tool.intent", runId, intent: lastIntent });
      yield { type: "tool.intent", intent: lastIntent };  // → CLI
      break;

    case "message_stop":
      // 有 tool intent? → 执行工具管道 → 继续 while(true)
      // 无 tool intent? → 当作 final answer → return
  }
}
```

---

## 四、Phase 4：第 1 轮工具执行 — 5 阶段管线

### 4.1 message_stop 到达，sawToolIntent=true (`agent-runtime.ts:128-165`)

```typescript
if (sawToolIntent && lastIntent) {
  // lastIntent = { intentId: "...", toolName: "bash",
  //                input: { command: "npm run test:sum", description: "Run test:sum" } }

  const result = await handleToolIntent({
    intent: lastIntent,
    executorMap: this.executorMap,
    approver: this.approver,      // cliApprover
    abortSignal: this.args.abortSignal
  });
```

### 4.2 `handleToolIntent()` 的 5 个阶段 (`tool-runtime.ts`)

| 阶段 | 做了什么 | 产出的事件 | 日志对应 |
|---|---|---|---|
| ① Validation | 从 executorMap 找到 bash executor，调用 `executor.validate(intent.input)` | `tool.validation` | `[tool_validation] bash ok=true` |
| ② Approval | 调用 `cliApprover(intent, bashExecutor)`。bashExecutor.name !== "read_file"，所以弹窗问用户 | `tool.approval` | `[tool_approval] bash decision=allow` |
| ③ Execution | `bashExecutor.execute({ command: "npm run test:sum" })` → 子进程运行 | `tool.execution.started` + `tool.execution.completed` | `[tool_execution_started] bash` / `[tool_execution_completed] bash type=failed` |
| ④ Observation | `bashExecutor.toObservation(result)` → 格式化成文本 | `tool.observation` | `[tool_observation] Tool: bash\nStatus: Failed\n...` |
| ⑤ Event append | 所有管线事件写入 EventBus | 5 条事件追加 | 见 `agent-runtime.ts:139-151` |

### 4.3 为什么 bash 需要审批而 read_file 不需要？(`main.ts:88-110`)

```typescript
async function cliApprover(intent: ToolIntent, executor: ToolExecutor): Promise<ApprovalDecision> {
  if (executor.name === "read_file") {
    return { type: "allow", reason: "Read-only tool, auto-allowed." };  // 自动放行
  }
  // bash、edit_file → 弹窗问用户
  const answer = await readline.question(`Allow this tool? (y/N) `);
  // ...
}
```

---

## 五、Phase 5：重建 Context 进入下一轮

### 5.1 从 EventBus 重建 Conversation State (`agent-runtime.ts:154-162`)

```typescript
const updatedState = reduceConversationState(this.eventBus.snapshot());
// EventBus 里现在有:
//   1. user.message
//   2. run.started
//   3. model.text.delta × N
//   4. model.tool.intent (bash)
//   5. tool.validation (bash)
//   6. tool.approval (bash)
//   7. tool.execution.started (bash)
//   8. tool.execution.completed (bash)
//   9. tool.observation (bash)
//   10. model.usage

// reduceConversationState() 折叠后:
// updatedState.messages = [
//   { role: "user", content: "请帮我运行 npm run test:sum并修复报错" },
//   { role: "assistant", content: "..." },   // model.text.delta 累积
//   { role: "user", content: "Tool: bash\nStatus: Failed\nExit code: 1\n..." }
//     ↑ tool.observation 被当作 user 角色消息！
// ]
```

### 5.2 重写 messages 数组 (`agent-runtime.ts:155-162`)

```typescript
messages.length = 0;  // 清空旧引用

// 拼上 system prompt（每次重建都加在最前面）
if (this.args.systemPrompt) {
  messages.push({ role: "system", content: this.args.systemPrompt });
}

// 拼上 baseMessages（当前为空）
if (this.args.baseMessages) {
  messages.push(...this.args.baseMessages);
}

// 拼上从 EventBus 折叠出来的对话历史
messages.push(...updatedState.messages);
```

### 5.3 继续 while(true) (`agent-runtime.ts:193-196`)

```typescript
if (toolExecuted) {
  toolExecuted = false;
  continue;  // 回到 while(true) 顶部，用新的 messages 再调 LLM
}
```

此时 `messages` 数组内容（发给 LLM 的上下文）：

```
[0] system:  "你是一个 CLI 编程助手。重要规则：..."
[1] user:     "请帮我运行 npm run test:sum并修复报错"
[2] assistant: ""（第 1 轮模型在 tool_intent 之前没有输出文本，所以 assistentDraft 为空）
[3] user:     "Tool: bash\nStatus: Failed\nExit code: 1\n\nCommand failed: npm run test:sum"
```

---

## 六、日志中关键转折点的代码对应

### 转折 1：模型发现 `sum.ts` 有 bug（日志行 180-293）

```
日志行 168: [model_tool_intent] bash — cat src/tests/sum.ts
日志行 175: [tool_observation] — export function sum(a, b) { return `${a}${b}`; }
日志行 184: [model_tool_intent] read_file — sum.test.ts
日志行 293: [model_tool_intent] edit_file — 替换模板字符串为 a + b
```

代码位置 `agent-runtime.ts:89` 的 `for await` 循环在第 N 轮（此时 messages 已包含前面的观察结果），模型看到 `sum.ts` 的源码，分析出 `\`\${a}\${b}\`` 是字符串拼接而非数学相加，决定发出 `edit_file` 的 tool_intent。

**关键**：强化后的 System Prompt（`main.ts:16-23`）起作用了 —— 模型这次的 `edit_file` 是真正通过原生 function calling 发出的（`model_tool_intent` 而非 `model_text_delta`）。

### 转折 2：edit_file 审批通过，执行成功（日志行 295-308）

```
[tool_validation] edit_file ok=true
[tool_approval] edit_file decision=allow      ← cliApprover 弹窗，用户输入 y
[tool_execution_started] edit_file
[tool_execution_completed] edit_file type=success duration=3ms
[tool_observation] Edited file: src/tests/sum.ts
  -export function sum(a, b) { return `${a}${b}`; }
  +export function sum(a, b) { return a + b; }
```

### 转折 3：重建后的 Context 包含 edit 结果，模型继续推理（日志行 308-339）

模型收到 observation："文件已修改，模板字符串 → a + b"。然后**自动推理**出还需要重新构建（因为测试运行的是 `dist/tests/` 下的 JS 文件）：

```
[model_tool_intent] bash {"command":"npm run build","description":"Build the project with tsc"}
→ [tool_observation] Build success
[model_tool_intent] bash {"command":"npm run test:sum"}
→ [tool_observation] TAP version 13 ... ok 1 - sum(1, 2) returns 3
```

这就是多轮循环的核心价值：模型不只是执行一个工具，而是**观察结果 → 推理下一步 → 继续调工具 → 直到目标达成**，整个过程通过 `while(true)` + messages 重建自动串联。

### 转折 4：最终 answer（日志行 357-543）

测试全部通过后，模型输出总结文本，此时 `message_stop` 到达且 `sawToolIntent=false`：

```typescript
// agent-runtime.ts:169-173
if (!sawToolIntent) {
  this.eventBus.append({ type: "model.final", runId, reason: event.stopReason, text });
  yield { type: "status", status: "completed" };
  return;  // ← 退出 while(true)，send() 结束
}
```

日志最后：
```
[final] 全部通过！✅ ... 三个测试用例全部通过：sum(1, 2) === 3 ✅、sum(-1, 5) === 4 ✅。
[run_finished] completed
[status] completed
```

---

## 七、完整时间线总结

```
时间轴（日志顺序）                        代码执行位置
──────────────────────────────────────  ──────────────────
main() 解析 --loop 参数                  main.ts:21
  └─ runLoopDemo() 组装 Runtime           main.ts:60-71
       └─ runtime.send({ text: "..." })   agent-runtime.ts:57
            │
            ├─ 写 user.message + run.started 事件         :58-60
            ├─ buildInitialMessages()                      :64
            │
            ╔═ while(true) 第 1 轮 ═══════════════════   :73
            ║  ├─ buildRequest() → ChatRequest              :74-82
            ║  ├─ for await (provider.stream())             :89
            ║  │   ├─ readSSE() yield chunk                openai.ts:278
            ║  │   ├─ stream() yield text_delta            openai.ts:150
            ║  │   ├─ stream() yield tool_intent (bash)    openai.ts:172
            ║  │   └─ stream() yield message_stop          openai.ts:179
            ║  ├─ handleToolIntent() → 5阶段管线            :130
            ║  │   ├─ validate() → ok=true                 tool-runtime.ts
            ║  │   ├─ cliApprover() → 弹窗 → allow         main.ts:88
            ║  │   ├─ bashExecutor.execute() → failed      tool-runtime.ts
            ║  │   └─ toObservation() → "Command failed"   tool-runtime.ts
            ║  ├─ reduceConversationState(snapshot())       :154
            ║  ├─ messages 重建（拼 system + history）       :155-162
            ║  └─ continue → 回到 while(true)               :196
            ║
            ╔═ while(true) 第 N 轮 ═══════════════════
            ║  ...（模型探索项目结构、读文件、定位 bug）
            ║  ├─ tool_intent: edit_file                    :108-119
            ║  ├─ handleToolIntent() → 编辑成功              :130
            ║  └─ messages 重建（含 edit 结果）               :154-162
            ║
            ╔═ while(true) 第 N+1 轮 ═══════════════════
            ║  ...（模型自动推理：需重建 → 跑测试）
            ║  ├─ tool_intent: bash("npm run build")       :108
            ║  ├─ tool_intent: bash("npm run test:sum")    :108
            ║  └─ observation: 测试全部通过 ✓
            ║
            ╔═ while(true) 最后一轮 ═══════════════════
            ║  ├─ text_delta: "全部通过！✅"                 :103
            ║  ├─ message_stop + sawToolIntent=false        :169
            ║  ├─ yield { type: "status", status: "completed" }  :172
            ║  └─ return                                    :173
            ║
main.ts 退出 for await                                main.ts:73
  └─ 打印 event log 总结                               main.ts:78-82
```

---

## 八、核心代码位置速查

| 你想知道什么 | 文件:行号 | 关键内容 |
|---|---|---|
| CLI 入口，参数解析 | `main.ts:20-22` | `parseArgs()`, `--loop` 判断 |
| Runtime 组装 | `main.ts:60-71` | tools, executors, approver 注入 |
| send() 入口，初始事件写入 | `agent-runtime.ts:57-61` | `runId` 生成, `user.message`, `run.started` |
| 初始化 messages（Context） | `agent-runtime.ts:300-310` | `buildInitialMessages()` |
| 多轮循环 while(true) | `agent-runtime.ts:73` | 每轮一次 LLM 调用 + 工具执行 |
| 三层 for...of 流式消费 | `agent-runtime.ts:89` | `for await (event of provider.stream())` |
| text_delta → eventBus + CLI | `agent-runtime.ts:102-106` | 拼接 text，写 EventBus，yield RuntimeOutput |
| tool_intent → 解析 + 记录 | `agent-runtime.ts:108-120` | `toToolIntent()`, 写 EventBus |
| message_stop + 有 tool → 执行 | `agent-runtime.ts:128-165` | `handleToolIntent()` × 5 阶段管线 |
| message_stop + 无 tool → 结束 | `agent-runtime.ts:169-173` | final answer → return |
| 工具执行后重建 Context | `agent-runtime.ts:154-162` | `reduceConversationState(snapshot())` → messages |
| Event → ConversationState | `conversation-state.ts:4-81` | 14 种事件 → `ChatMessage[]` |
| observation 作为 user 角色 | `conversation-state.ts:70` | `{ role: "user", content: observation.content }` |
| assistant draft flush | `conversation-state.ts:28,43,83-91` | text_delta 累积 → 遇到 tool_intent 或 final 时 flush |
| read_file 自动放行 | `main.ts:90-92` | `if (executor.name === "read_file") return allow` |
| bash/edit_file 需要审批 | `main.ts:95-109` | `readline.question("Allow this tool? (y/N)")` |
| SSE 字节流 → 行解析 | `openai.ts:258-294` | `readServerSentEvents()` |
| ModelEvent 翻译 | `openai.ts:93-183` | `OpenAIProvider.stream()` |
| System Prompt | `main.ts:16-23` | 6 条规则，要求原生 function calling |
