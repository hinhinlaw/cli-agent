# 00-09 M0 Core Kernel Knowledge Notes

Source: `/Applications/study/ai/learn-agent/src/content/blog/zh/AI/build-harness/00-09-m0-core-kernel.md`

## Core Thesis

M0 exists to connect real model providers without letting provider response formats take over the system boundary. The provider is a capability entry point; the core kernel preserves contracts, state, event history, and runtime authority.

## Important Knowledge Points

- Fake providers can prove a loop runs, but cannot expose real provider complexity: streaming deltas, tool call fragments, usage, request IDs, rate limits, context length errors, and provider-specific stop reasons.
- The core should not adapt itself to a provider. Provider adapters should adapt external APIs into core-owned internal language.
- The M0 kernel has five responsibility pillars:
  - `contracts`: provider and runtime speak the same internal language.
  - `registry`: capabilities are registered before use, not guessed during execution.
  - `event bus`: facts become an append-only event stream.
  - `conversation state`: model-visible context is a projection, not the whole fact store.
  - `runtime facade`: CLI and future hosts call runtime, not provider internals.
- `ToolIntent` is not `ToolExecution`. A model can propose an action, but the system has not executed it yet.
- Provider output must become internal `ModelEvent`/runtime events before the rest of the system sees it.
- Provider-owned IDs may be preserved as references, but core should generate its own stable intent IDs and runtime IDs.
- Messages must not serve as log, state, and context all at once. Event log, state, and context projection are separate concepts.
- Tool schemas exposed to the model are a projection from registry, not loose prompt text.
- CLI should be thin and replaceable. It should render runtime outputs and not own provider streaming, state mutation, or tool execution decisions.
- M0 tests should verify control boundaries, not model intelligence:
  - user input becomes an event.
  - model text deltas are recorded and yielded.
  - model tool intent becomes pending state.
  - tools are not executed.
  - state can be rebuilt from event history.
  - provider private objects do not leak through runtime facade.

## Current Project Gap

- `src/providers/contract.ts` already has a provider-facing `ModelEvent`, but event names are provider-ish (`message_start`, `text_delta`, `message_stop`) rather than runtime fact events.
- `src/runtime/run-agent-loop.ts` currently combines collection, loop state, tool intent parsing, immediate tool execution, observation message creation, and final answer handling in one function.
- Current tests assert that tool observations are fed into the next model turn. That behavior belongs after M0, not inside 00-09 M0.
- `src/cli/main.ts` currently owns a loop demo with fake tools. In M0, it should call a runtime facade and render outputs.

## Implementation Direction

- Keep provider adapter shape but route it through a runtime facade.
- Add core runtime events such as user message, run started, model text delta, model tool intent, usage, run finished, error.
- Add an event bus with append/subscribe/snapshot.
- Add a reducer that builds conversation state from events, including pending tool intents.
- Add a tool registry with minimal visible tool projection.
- Replace immediate execution in the M0 path with pending tool intent output.
- Keep any old execution-oriented test expectations only if moved out of M0 or rewritten as post-M0 TODOs.

