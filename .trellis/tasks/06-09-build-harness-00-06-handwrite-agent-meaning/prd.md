# Build Harness 00-06：手写 Agent 的意义

## Source

- Local article: `/Applications/study/ai/learn-agent/src/content/blog/zh/AI/build-harness/00-06-handwrite-agent-meaning.md`
- Title: `手写 Agent 的意义：理解框架抽象背后的最小机制`
- Article date: `2026-05-29`

## Goal

理解手写最小 Agent 的目标不是替代框架，而是获得判断框架抽象边界的工程手感。

## Scope

- 记录为什么要手写最小机制。
- 记录顺风 demo 和真实任务之间的四个坑。
- 记录手写时只摸的五个承重点。
- 记录后续最小手写路线图。
- 记录下一篇正式进入 `LLM Provider`。

## Out of Scope

- 不实现 `protocol.ts`。
- 不实现 `message.ts`。
- 不实现 `model.ts`。
- 不实现 `mockModel.ts`。
- 不实现 `loop.ts`。
- 不实现 `tools.ts`。
- 不实现 `sessionStore.ts`。

## Acceptance Criteria

- 已记录手写 Agent 的学习目的。
- 已记录后续代码落点。
- 已明确下一篇才开始第一段代码：LLM Provider。
