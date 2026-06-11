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

## Scenario: M0 Core Kernel Runtime API

### 1. Scope / Trigger

- Trigger: adding or changing the provider-agnostic runtime API for Build Harness 00-09 M0 Core Kernel.
- Applies to: `src/runtime/agent-runtime.ts`, `src/runtime/contracts.ts`, `src/runtime/event-bus.ts`, `src/runtime/conversation-state.ts`, `src/runtime/tool-registry.ts`, provider contracts, and CLI code that calls the runtime.
- Boundary: M0 proves provider output enters core-owned contracts and event history. It does **not** execute tools. Tool execution belongs to the later Intent/Execution milestone.

### 2. Signatures

```ts
new AgentRuntime({
  provider: LlmProvider
  model: string
  systemPrompt?: string
  baseMessages?: ChatMessage[]
  tools?: ToolDefinition[]
  temperature?: number
  maxOutputTokens?: number
  abortSignal?: AbortSignal
})

runtime.send({ text: string }): AsyncIterable<RuntimeOutput>
runtime.getState(): ConversationState
runtime.getEvents(): RuntimeEvent[]
```

### 3. Contracts

- Provider adapters translate external API responses into provider-level `ModelEvent`; provider private response objects must not leak into runtime state.
- `ChatRequest.tools` is the structured provider request projection from `ToolRegistry`; do not rely only on prompt text for tool definitions.
- Runtime facts are append-only `RuntimeEvent` entries. State is rebuilt from events via the reducer.
- `ToolIntent` is a pending application/request, not proof of execution.
- CLI calls the runtime facade and renders `RuntimeOutput`; it must not call provider streams directly in agent mode or mutate conversation state.
- `runAgentLoop` is only a compatibility wrapper over the M0 runtime facade and must keep M0 no-execution semantics.

### 4. Validation & Error Matrix

| Condition | Runtime behavior |
| --- | --- |
| Model emits text deltas and `message_stop` without tool intent | Append model text events, finalize state as `completed` |
| Model emits `tool_intent` with JSON object arguments | Record `model.tool.intent`, add to `pendingToolIntents`, finish as `waiting_for_tool` |
| Model emits malformed or non-object tool arguments | Emit `runtime.error` with `code: "invalid_tool_intent"` and finish as `failed` |
| Provider emits fragmented tool call arguments | Provider adapter must aggregate fragments before yielding one `tool_intent` |
| Provider emits error event | Convert to `runtime.error` and finish as `failed` |
| `abortSignal.aborted` | Emit abort error and finish as `aborted` |
| Tool implementation exists in registry | Do not execute it in M0 |

### 5. Good/Base/Bad Cases

- Good: provider emits text plus `tool_intent`; runtime yields text and `tool.intent`, event log records the intent, state becomes `waiting_for_tool`, and no tool function runs.
- Base: provider returns final text on the first run; runtime records events and state becomes `completed`.
- Bad: provider adapter yields every OpenAI argument fragment as a separate tool intent.
- Bad: CLI builds provider messages itself or inserts tool descriptions only as prompt text.
- Bad: M0 turns tool intent into `Observation:` messages or runs shell/file/edit actions.

### 6. Tests Required

- Runtime final text path: output events, event log types, final state.
- Tool intent path: pending intent exists, state is `waiting_for_tool`, no observation text is produced.
- State reducer rebuilds pending tool state from event arrays.
- Runtime rejects malformed tool intent args.
- Provider adapter aggregates streamed tool call fragments into one tool intent.
- Registry projection reaches `ChatRequest.tools`.
- CLI agent mode renders pending intent/status and does not print observations/final fix text.

### 7. Wrong vs Correct

#### Wrong

```ts
// M0 crosses the Intent/Execution boundary too early.
const result = await registry.get(intent.toolName)?.execute(intent.input)
messages.push({ role: "user", content: `Observation: ${result.summary}` })
```

#### Correct

```ts
eventBus.append({ type: "model.tool.intent", runId, intent })
yield { type: "tool.intent", intent }
```
