import type { ChatMessage, TokenUsage } from "../providers/contract.js";
import type { ConversationState, RuntimeEvent } from "./contracts.js";

export function reduceConversationState(events: readonly RuntimeEvent[]): ConversationState {
  const state: ConversationState = {
    status: "idle",
    turn: 0,
    messages: [],
    pendingToolIntents: [],
    usage: {}
  };
  let assistantDraft = "";

  for (const event of events) {
    switch (event.type) {
      case "user.message":
        state.runId = event.runId;
        state.messages.push({ role: "user", content: event.text });
        break;

      case "run.started":
        state.runId = event.runId;
        state.status = "running";
        break;

      case "model.text.delta":
        assistantDraft += event.text;
        break;

      case "model.tool.intent":
        flushAssistantDraft(state.messages, assistantDraft);
        assistantDraft = "";
        state.pendingToolIntents.push(event.intent);
        state.status = "waiting_for_tool";
        break;

      case "model.usage":
        state.usage = mergeUsage(state.usage, event.usage);
        break;

      case "model.final":
        flushAssistantDraft(state.messages, assistantDraft || event.text);
        assistantDraft = "";
        state.status = "completed";
        break;

      case "run.finished":
        state.status = event.status;
        break;

      case "runtime.error":
        state.lastError = event.error;
        state.status = "failed";
        break;
    }
  }

  flushAssistantDraft(state.messages, assistantDraft);
  return state;
}

function flushAssistantDraft(messages: ChatMessage[], draft: string): void {
  if (draft.length === 0) return;
  const last = messages.at(-1);
  if (last?.role === "assistant") {
    last.content += draft;
    return;
  }
  messages.push({ role: "assistant", content: draft });
}

function mergeUsage(current: TokenUsage, next: TokenUsage): TokenUsage {
  return {
    inputTokens: sum(current.inputTokens, next.inputTokens),
    outputTokens: sum(current.outputTokens, next.outputTokens),
    totalTokens: sum(current.totalTokens, next.totalTokens)
  };
}

function sum(left: number | undefined, right: number | undefined): number | undefined {
  if (left === undefined && right === undefined) return undefined;
  return (left ?? 0) + (right ?? 0);
}

