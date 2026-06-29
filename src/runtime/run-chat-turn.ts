import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatRequest, LlmProvider, TokenUsage } from "../providers/contract.js";
import { mapProviderErrorToRuntimeError, RuntimeError } from "../providers/errors.js";

export interface RunChatTurnArgs {
  provider: LlmProvider;
  model: string;
  messages: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  onTextDelta: (text: string) => void;
}

export interface RunChatTurnResult {
  text: string;
  usage?: TokenUsage;
  stopReason?: string;
}

export async function runChatTurn(args: RunChatTurnArgs): Promise<RunChatTurnResult> {
  const request: ChatRequest = {
    model: args.model,
    messages: args.messages,
    temperature: args.temperature,
    maxOutputTokens: args.maxOutputTokens,
    abortSignal: args.abortSignal,
    metadata: {
      turnId: randomUUID()
    }
  };

  let text = "";

  for await (const event of args.provider.stream(request)) {
    switch (event.type) {
      case "model.started":
        break;

      case "model.text_delta":
        text += event.text;
        args.onTextDelta(event.text);
        break;

      case "model.finished":
        return {
          text,
          usage: event.usage,
          stopReason: event.stopReason
        };

      case "tool_intent.proposed":
        throw new RuntimeError("Tool intent was emitted, but Tool Runtime is not enabled in this milestone.");

      case "provider.error":
        throw mapProviderErrorToRuntimeError(event.error);
    }
  }

  return { text };
}
