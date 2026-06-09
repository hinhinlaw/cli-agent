# 00-07 知识点映射

## 当前实现目标

本篇开始写第一段真实代码，但只实现 Provider 和一次 CLI 调用。

## 代码映射

| 博客知识点 | 本篇代码位置 | 说明 |
| --- | --- | --- |
| Provider Contract | `src/providers/contract.ts` | 定义 `ChatRequest`、`ModelEvent`、`ProviderError` |
| Fake Provider | `src/providers/fake.ts` | 用固定 stream 测 runtime |
| OpenAI Provider | `src/providers/openai.ts` | 真实 adapter，只做协议翻译 |
| Error Mapping | `src/providers/errors.ts` | 把 raw error 映射为结构化错误 |
| Config | `src/config/load-provider-config.ts` | 从环境变量读取 provider 配置 |
| Runtime Turn | `src/runtime/run-chat-turn.ts` | 只处理 provider contract 事件 |
| CLI | `src/cli/main.ts` | 读取输入，打印 `text_delta` |

## 边界

- 不做 Agent Loop。
- 不执行工具。
- 不做重试、fallback、session replay。
- Provider 不拥有工具执行权。
