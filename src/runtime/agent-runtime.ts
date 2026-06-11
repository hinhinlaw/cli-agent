import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatRequest, LlmProvider, ModelEvent, ProviderError } from "../providers/contract.js";
import { EventBus } from "./event-bus.js";
import { reduceConversationState } from "./conversation-state.js";
import { ToolRegistry } from "./tool-registry.js";
import type { ConversationState, RuntimeErrorEvent, RuntimeEvent, RuntimeOutput, ToolDefinition, ToolIntent } from "./contracts.js";

export interface AgentRuntimeArgs {
  provider: LlmProvider;
  model: string;
  systemPrompt?: string;
  baseMessages?: ChatMessage[];
  tools?: ToolDefinition[];
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  eventBus?: EventBus;
}

export interface UserInput {
  text: string;
}

export class AgentRuntime {
  private readonly eventBus: EventBus;
  private readonly toolRegistry: ToolRegistry;

  constructor(private readonly args: AgentRuntimeArgs) {
    this.eventBus = args.eventBus ?? new EventBus();
    this.toolRegistry = new ToolRegistry(args.tools ?? []);
  }

  async *send(input: UserInput): AsyncIterable<RuntimeOutput> {
    const runId = randomUUID();
    this.eventBus.append({ type: "user.message", runId, text: input.text });
    this.eventBus.append({ type: "run.started", runId });
    yield { type: "status", status: "running" };

    const request = this.buildRequest(runId);
    let text = "";
    let sawToolIntent = false;

    for await (const event of this.args.provider.stream(request)) {
      if (this.args.abortSignal?.aborted) {
        const error = runtimeError("aborted", "Run was aborted.", false);
        this.eventBus.append({ type: "runtime.error", runId, error });
        this.eventBus.append({ type: "run.finished", runId, status: "aborted", reason: "aborted" });
        yield { type: "error", error };
        return;
      }

      switch (event.type) {
        case "message_start":
          break;

        case "text_delta":
          text += event.text;
          this.eventBus.append({ type: "model.text.delta", runId, text: event.text });
          yield { type: "text.delta", text: event.text };
          break;

        case "tool_intent": {
          const intentOrError = toToolIntent(event, this.args.provider.name);
          if (intentOrError.error) {
            this.eventBus.append({ type: "runtime.error", runId, error: intentOrError.error });
            this.eventBus.append({ type: "run.finished", runId, status: "failed", reason: "invalid_tool_intent" });
            yield { type: "error", error: intentOrError.error };
            return;
          }
          sawToolIntent = true;
          this.eventBus.append({ type: "model.tool.intent", runId, intent: intentOrError.intent });
          yield { type: "tool.intent", intent: intentOrError.intent };
          break;
        }

        case "message_stop":
          if (event.usage) {
            this.eventBus.append({ type: "model.usage", runId, usage: event.usage });
          }
          if (sawToolIntent) {
            this.eventBus.append({ type: "run.finished", runId, status: "waiting_for_tool", reason: event.stopReason });
            yield { type: "status", status: "waiting_for_tool" };
            return;
          }
          this.eventBus.append({ type: "model.final", runId, reason: event.stopReason, text });
          this.eventBus.append({ type: "run.finished", runId, status: "completed", reason: event.stopReason });
          yield { type: "status", status: "completed" };
          return;

        case "error": {
          const error = providerRuntimeError(event.error);
          this.eventBus.append({ type: "runtime.error", runId, error });
          this.eventBus.append({ type: "run.finished", runId, status: "failed", reason: event.error.kind });
          yield { type: "error", error };
          return;
        }
      }
    }

    this.eventBus.append({ type: "model.final", runId, text });
    this.eventBus.append({ type: "run.finished", runId, status: "completed" });
    yield { type: "status", status: "completed" };
  }

  getState(): ConversationState {
    return reduceConversationState(this.eventBus.snapshot());
  }

  getEvents(): RuntimeEvent[] {
    return this.eventBus.snapshot();
  }

  onEvent(listener: (event: RuntimeEvent) => void): () => void {
    return this.eventBus.subscribe(listener);
  }

  private buildRequest(runId: string): ChatRequest {
    const messages: ChatMessage[] = [];
    if (this.args.systemPrompt) {
      messages.push({ role: "system", content: this.args.systemPrompt });
    }
    const visibleTools = this.toolRegistry.visibleTools();
    messages.push(...(this.args.baseMessages ?? []));
    messages.push({ role: "user", content: latestUserMessage(this.eventBus.snapshot(), runId) });

    return {
      model: this.args.model,
      messages,
      tools: visibleTools.map((tool) => ({
        name: tool.name,
        description: tool.description,
        inputSchema: tool.inputSchema
      })),
      temperature: this.args.temperature,
      maxOutputTokens: this.args.maxOutputTokens,
      abortSignal: this.args.abortSignal,
      metadata: {
        sessionId: runId,
        turnId: runId
      }
    };
  }
}

function latestUserMessage(events: readonly RuntimeEvent[], runId: string): string {
  for (let index = events.length - 1; index >= 0; index -= 1) {
    const event = events[index];
    if (event.type === "user.message" && event.runId === runId) {
      return event.text;
    }
  }
  return "";
}

function toToolIntent(
  event: Extract<ModelEvent, { type: "tool_intent" }>,
  provider: string
): { intent: ToolIntent; error?: never } | { intent?: never; error: RuntimeErrorEvent } {
  try {
    const parsed = JSON.parse(event.argumentsText || "{}") as unknown;
    if (!isRecord(parsed)) {
      return { error: runtimeError("invalid_tool_intent", `Tool intent arguments for ${event.name} must be a JSON object.`, true) };
    }
    return {
      intent: {
        intentId: randomUUID(),
        toolName: event.name,
        input: parsed,
        providerRef: {
          provider,
          rawId: event.id
        }
      }
    };
  } catch (error) {
    return {
      error: runtimeError(
        "invalid_tool_intent",
        error instanceof Error ? error.message : `Tool intent arguments for ${event.name} are invalid.`,
        true
      )
    };
  }
}

function providerRuntimeError(error: ProviderError): RuntimeErrorEvent {
  return {
    code: "provider_error",
    message: error.message,
    retryable: error.retryable,
    providerError: error
  };
}

function runtimeError(code: RuntimeErrorEvent["code"], message: string, retryable: boolean): RuntimeErrorEvent {
  return { code, message, retryable };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
