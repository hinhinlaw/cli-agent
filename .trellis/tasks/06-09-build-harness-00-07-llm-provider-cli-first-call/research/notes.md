# 00-07 研究笔记：LLM Provider

## 核心结论

Provider 只负责把模型能力翻译成统一事件，不拥有工具执行权和会话事实源。

第一次模型调用不是直接把 SDK 写进 CLI，而是先建立 provider contract，让后续 runtime 可以只依赖统一协议。

## 最小 Contract

输入：

- 本轮 messages。
- 模型参数。
- abort signal。
- trace metadata。

输出：

- `ModelEvent` 流。

错误：

- 统一映射为 `ProviderError`。

核心类型：

- `ChatMessage`
- `ChatRequest`
- `ModelEvent`
- `TokenUsage`
- `ProviderError`
- `LlmProvider`
- `ChatResult`

## 关键边界

- 内部 messages 是 runtime 的事实表达。
- Provider messages 只是 adapter 的传输表达。
- CLI 不直接解析 SSE。
- Runtime 不接触 provider 原始 stream chunk。
- `tool_intent` 只作为事件预留，不在 Provider 执行。
- Provider 错误必须映射为可决策错误类型。

## CLI 链路

```text
cli.ts
-> 读取用户输入
-> load provider config
-> create provider adapter
-> runChatTurn()
-> provider.stream()
-> Runtime 接收 ModelEvent
-> CLI 打印 text_delta
```

## Provider Adapter 职责

Adapter 负责四件事：

- normalize request
- call provider
- normalize stream
- normalize error

Adapter 应该薄在业务判断上，厚在协议翻译上。

## 凭证纪律

- API key 只进入 provider config。
- API key、base URL、headers 不进入 messages。
- 用户可见错误和内部错误分离。
- 错误映射不暴露 Authorization header。

## 测试策略

Core 正确性不能依赖真实 API。

Fake provider 应覆盖：

- `runChatTurn` 打印所有 `text_delta`。
- `message_stop` 后结束。
- `tool_intent` 被明确拒绝。
- `ProviderError` 被映射成 runtime error。

真实 provider 侧至少保证：

- raw stream event -> `ModelEvent`。
- raw error -> `ProviderError`。
- messages -> provider request。
