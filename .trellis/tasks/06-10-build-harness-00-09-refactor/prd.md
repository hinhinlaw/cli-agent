# Build Harness 00-09 M0 Core Kernel Refactor

## Goal

Refactor the current minimal CLI agent so it follows the local Build Harness 00-09 article, `M0 Core Kernel：真实模型接入系统边界`. The project should move from a demo loop that executes tools immediately to an M0 core kernel where provider output is normalized into internal events, tool intent is recorded as pending state, and the CLI calls a runtime facade instead of owning provider/runtime details.

## What I Already Know

- User asked to strictly follow article 00-09 and to record its important knowledge points.
- The local article is at `/Applications/study/ai/learn-agent/src/content/blog/zh/AI/build-harness/00-09-m0-core-kernel.md`.
- The author implementation reference is `/Applications/study/ai/guga-agent`.
- Current project already has provider contracts and a minimal `runAgentLoop`, but `runAgentLoop` executes tools immediately and feeds observations back into the next model turn.
- 00-09 explicitly says M0 should not execute tools yet. `ToolIntent` is an application/request, not execution.
- `guga-agent` is much larger; use it as a directional reference for contracts, registry, event bus, state, runtime facade, not as a copy target.

## Requirements

- Add/reshape core contracts so provider/model output becomes project-owned runtime events.
- Introduce an append-only event bus for M0 facts.
- Introduce conversation state that can be rebuilt from events and contains pending tool intents.
- Introduce a tool registry that records tool definitions and projects visible tools into model requests.
- Introduce a runtime facade that accepts user input, calls the provider, records events, yields runtime outputs, and exposes state/events.
- Keep the CLI thin: it should call the runtime facade and render outputs.
- M0 must record model tool intent without executing it.
- Preserve the existing real provider abstraction where possible instead of replacing it wholesale.
- Update tests to assert the M0 boundary: tool intent enters pending state; tool executors are not called in this milestone.
- Record the 00-09 article knowledge points in task research and, if they become project conventions, in Trellis specs during finish.

## Acceptance Criteria

- [x] `npm run build` passes.
- [x] `npm test` passes.
- [x] A model `tool_intent` event is converted into runtime output and persisted in event history.
- [x] Conversation state rebuilt from runtime events enters a waiting/pending-tool state.
- [x] Tool registry definitions are used to build the provider request tools/catalog projection.
- [x] The M0 runtime does not execute tool implementations.
- [x] CLI no longer owns the agent loop internals; it calls the runtime facade.
- [x] 00-09 knowledge points are captured under `research/`.

## Out of Scope

- Full Tool Runtime and permission approval flow.
- Shell/file/edit tool execution.
- Long-term memory, replay persistence, sandboxing, multi-agent delegation.
- Porting the full `guga-agent` package structure.

## Technical Notes

- Article reference: `/Applications/study/ai/learn-agent/src/content/blog/zh/AI/build-harness/00-09-m0-core-kernel.md`.
- Reference implementation patterns:
  - `/Applications/study/ai/guga-agent/packages/core/src/runtime/agent-runtime.ts`
  - `/Applications/study/ai/guga-agent/packages/core/src/loop/agent-loop.ts`
  - `/Applications/study/ai/guga-agent/packages/core/src/events/event-bus.ts`
  - `/Applications/study/ai/guga-agent/packages/core/src/state/conversation-state.ts`
- Current likely change surface:
  - `src/providers/contract.ts`
  - `src/runtime/**`
  - `src/cli/main.ts`
  - runtime tests.

## Research References

- [`research/00-09-m0-core-kernel.md`](research/00-09-m0-core-kernel.md) — distilled article principles and current-code implications.
