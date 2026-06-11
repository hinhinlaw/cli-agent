import type { ChatMessage, ProviderError, TokenUsage } from "../providers/contract.js";

export interface ToolIntent {
  intentId: string;
  toolName: string;
  input: Record<string, unknown>;
  providerRef?: {
    provider: string;
    rawId?: string;
  };
}

export type ToolRisk = "read" | "write" | "execute" | "network";

export interface ToolDefinition {
  name: string;
  description: string;
  inputSchema?: unknown;
  risk: ToolRisk;
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  visible?: boolean;
}

export type RuntimeStatus = "idle" | "running" | "waiting_for_tool" | "completed" | "failed" | "aborted";

export type RuntimeEvent =
  | { type: "user.message"; runId: string; text: string }
  | { type: "run.started"; runId: string }
  | { type: "model.text.delta"; runId: string; text: string }
  | { type: "model.tool.intent"; runId: string; intent: ToolIntent }
  | { type: "model.usage"; runId: string; usage: TokenUsage }
  | { type: "model.final"; runId: string; reason?: string; text: string }
  | { type: "run.finished"; runId: string; status: RuntimeStatus; reason?: string }
  | { type: "runtime.error"; runId: string; error: RuntimeErrorEvent };

export type RuntimeOutput =
  | { type: "text.delta"; text: string }
  | { type: "tool.intent"; intent: ToolIntent }
  | { type: "status"; status: RuntimeStatus }
  | { type: "error"; error: RuntimeErrorEvent };

export interface RuntimeErrorEvent {
  code: "provider_error" | "invalid_tool_intent" | "aborted";
  message: string;
  retryable: boolean;
  providerError?: ProviderError;
}

export interface ConversationState {
  runId?: string;
  status: RuntimeStatus;
  turn: number;
  messages: ChatMessage[];
  pendingToolIntents: ToolIntent[];
  usage: TokenUsage;
  lastError?: RuntimeErrorEvent;
}

