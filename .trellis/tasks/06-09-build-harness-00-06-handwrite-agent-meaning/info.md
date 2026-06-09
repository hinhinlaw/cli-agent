# 00-06 知识点映射

## 当前代码状态

本篇没有新增 Agent 代码。

原因：`00-06-handwrite-agent-meaning.md` 是进入代码前的最后一篇定位文章。它定义为什么手写、手写哪些承重点，以及下一篇从 LLM Provider 开始。

## 后续实现约束

- 手写最小 Agent 是教学手段，不是要替代框架。
- 只摸承重点，不提前做完整框架。
- Provider 只负责模型调用，不执行工具、不管理任务世界。
- Eval 后续必须能归因 trajectory，而不是只判断最终答案。
- Verification Gate 后续必须禁止模型空口宣布完成。

## 概念到未来代码的预映射

| 博客知识点 | 未来代码位置 | 说明 |
| --- | --- | --- |
| Model output -> Intent | `protocol.ts` / `message.ts` | 区分 final、tool intent、observation |
| Provider 适配层 | `model.ts` | 统一模型调用接口 |
| Mock model | `mockModel.ts` | 用确定输出测试 loop |
| Loop -> State transition | `loop.ts` | 只处理 final 和 tool intent |
| Tools -> Protocol boundary | `tools.ts` | 工具是协议入口，不是裸函数 |
| Event log -> State | `sessionStore.ts` | 从事实事件折叠状态 |

## 本篇验收

- 已记录手写 Agent 的意义。
- 已记录五个承重点。
- 已记录后续文件落点。
- 已明确 `00-07` 才开始实现 LLM Provider。
