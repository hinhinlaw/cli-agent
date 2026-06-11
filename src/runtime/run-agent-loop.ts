import type { ChatMessage, LlmProvider, TokenUsage } from "../providers/contract.js";
import { AgentRuntime } from "./agent-runtime.js";
import type { RuntimeEvent, RuntimeOutput, RuntimeStatus, ToolDefinition, ToolIntent } from "./contracts.js";

export type AgentToolSpec = ToolDefinition;
export type AgentLoopEvent = RuntimeEvent;

export interface RunAgentLoopArgs {
  model: LlmProvider;
  modelName: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  tools?: ToolDefinition[];
  maxTurns?: number;
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}

export interface RunAgentLoopResult {
  outputs: RuntimeOutput[];
  events: RuntimeEvent[];
  pendingToolIntents: ToolIntent[];
  finalAnswer?: string;
  usage?: TokenUsage;
  stopReason: "final" | "waiting_for_tool" | "failed" | "aborted";
}

/**
 * Compatibility wrapper for the M0 runtime facade.
 *
 * 00-09 M0 deliberately records tool intent without executing tools. The old
 * 00-08 loop API name is kept so callers can migrate without keeping a second
 * control path that violates the M0 boundary.
 */
export async function runAgentLoop(args: RunAgentLoopArgs): Promise<RunAgentLoopResult> {
  const userMessage = findLastUserMessage(args.messages);
  const baseMessages = userMessage
    ? args.messages.filter((message) => message !== userMessage)
    : args.messages;
  const runtime = new AgentRuntime({
    provider: args.model,
    model: args.modelName,
    systemPrompt: args.systemPrompt,
    baseMessages,
    tools: args.tools,
    temperature: args.temperature,
    maxOutputTokens: args.maxOutputTokens,
    abortSignal: args.abortSignal
  });
  const outputs: RuntimeOutput[] = [];

  for await (const output of runtime.send({ text: userMessage?.content ?? "" })) {
    outputs.push(output);
  }

  const state = runtime.getState();
  return {
    outputs,
    events: runtime.getEvents(),
    pendingToolIntents: state.pendingToolIntents,
    finalAnswer: finalAnswerFromState(state.messages),
    usage: state.usage,
    stopReason: toLoopStopReason(state.status)
  };
}

function findLastUserMessage(messages: readonly ChatMessage[]): ChatMessage | undefined {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index];
    if (message.role === "user") {
      return message;
    }
  }
  return undefined;
}

function finalAnswerFromState(messages: ChatMessage[]): string | undefined {
  const last = messages.at(-1);
  return last?.role === "assistant" ? last.content : undefined;
}

function toLoopStopReason(status: RuntimeStatus): RunAgentLoopResult["stopReason"] {
  switch (status) {
    case "completed":
      return "final";
    case "waiting_for_tool":
      return "waiting_for_tool";
    case "aborted":
      return "aborted";
    case "failed":
      return "failed";
    case "idle":
    case "running":
      return "failed";
  }
}
