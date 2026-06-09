# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

(To be filled by the team)

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)

---

## Scenario: Minimal Agent Loop Runtime API

### 1. Scope / Trigger

- Trigger: adding or changing the provider-agnostic Agent Loop runtime API.
- Applies to: `src/runtime/run-agent-loop.ts` and tests that exercise model event -> tool intent -> observation -> next model turn.
- Boundary: the loop is core runtime code. It must not know HTTP, React, session files, real filesystem tools, or provider-specific tool calling formats.

### 2. Signatures

```ts
runAgentLoop(args: {
  model: LlmProvider
  modelName: string
  messages: ChatMessage[]
  systemPrompt?: string
  tools?: AgentToolSpec[]
  toolRegistry: ToolRegistry
  maxTurns?: number
  temperature?: number
  maxOutputTokens?: number
  abortSignal?: AbortSignal
}): Promise<{
  newMessages: ChatMessage[]
  events: AgentLoopEvent[]
  finalAnswer?: string
  stopReason: "final" | "max_turns_exceeded" | "aborted"
}>
```

### 3. Contracts

- `messages` are the base model-visible context supplied by the caller.
- `newMessages` contain only messages created during this loop run.
- Tool observations are projected back into `newMessages` as ordinary `user` messages beginning with `Observation:`. Do not add a new provider role unless every provider adapter supports the new role contract.
- `events` are runtime facts for the caller to inspect; they are not a persistent session log yet.
- `toolRegistry` owns execution. The model may emit `tool_intent`, but the loop validates and executes it.

### 4. Validation & Error Matrix

| Condition | Runtime behavior |
| --- | --- |
| Model emits final text and `message_stop` | Append assistant message, emit `final`, return `stopReason: "final"` |
| Model emits known `tool_intent` with JSON object arguments | Execute tool, turn result into observation, continue next turn |
| Model emits unknown tool | Do not execute; append failed observation with `errorType: "unknown_tool"` |
| Model emits malformed or non-object tool arguments | Do not execute; append retryable observation with `errorType: "invalid_tool_intent"` |
| Tool throws | Catch and append failed observation with `errorType: "tool_error"` |
| `turn >= maxTurns` | Emit `stop`, return `stopReason: "max_turns_exceeded"` |
| `abortSignal.aborted` | Emit `stop`, return `stopReason: "aborted"` |
| Provider emits error event | Map through provider error handling and throw `RuntimeError` |

### 5. Good/Base/Bad Cases

- Good: fake provider first emits `tool_intent`, fake tool returns observation, second provider call sees `Observation:` and returns final.
- Base: model returns final on the first turn; loop returns one assistant `newMessages` entry.
- Bad: loop executes unknown tools, or only prints tool output without adding an observation to `newMessages`.

### 6. Tests Required

- Final response exits the loop and returns `stopReason: "final"`.
- Tool result is converted into an observation visible in the next model request.
- Unknown tool and invalid arguments become observations instead of execution.
- `maxTurns` stops the loop after the latest observation.
- Tests must use fake providers/tools and must not require real network, filesystem tools, shell commands, or API keys.

### 7. Wrong vs Correct

#### Wrong

```ts
// Tool output is printed but never becomes model-visible context.
console.log(await tool.execute(args))
```

#### Correct

```ts
const result = await tool.execute(intent.input, intent)
newMessages.push({
  role: "user",
  content: `Observation: ${intent.name} ${result.ok ? "succeeded" : "failed"}`
})
```
