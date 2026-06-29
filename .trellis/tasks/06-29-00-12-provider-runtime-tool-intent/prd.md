## 00-12 Provider Runtime: 改造计划

### 目标
将现有代码中的 ModelEvent 重命名以匹配文章 00-12 的分层设计，抽取 ToolCallAssembler，新增边界测试。

### 变更清单

**1. 重命名 ModelEvent (src/providers/contract.ts)**
- `message_start` → `model.started`
- `text_delta` → `model.text_delta`
- `message_stop` → `model.finished`
- `tool_intent` → 拆成 `tool_intent.delta` + `tool_intent.proposed`
- `error` → `provider.error`
- 新增 `ToolIntentProposed` 类型（含 source 追溯）

**2. 抽取 ToolCallAssembler (新增 src/providers/tool-call-assembler.ts)**
- 从 OpenAIProvider 内联的 toolCallFragments 逻辑抽出

**3. 更新 OpenAIProvider**
- 使用 ToolCallAssembler
- 产出新事件名
- streaming 中产出 tool_intent.delta

**4. 更新消费者**
- agent-runtime.ts, run-chat-turn.ts, fake.ts, main.ts — switch case 新事件名

**5. 更新所有测试**
- 7 个 .test.ts 文件中 ScriptedProvider 事件名替换

**6. 新增边界测试 (provider-runtime.test.ts)**
- 6 类测试：归一化、不执行工具、delta 组装、错误分类、request-scoped、result projection
