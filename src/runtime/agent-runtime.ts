import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatRequest, LlmProvider, ModelEvent, ProviderError } from "../providers/contract.js";
import type { CapabilityRegistry } from "../core/registry.js";
import type { HookKernel } from "../plugins/hook-kernel.js";
import { EventBus } from "./event-bus.js";
import { reduceConversationState } from "./conversation-state.js";
import { ToolRegistry } from "./tool-registry.js";
import { handleToolIntent } from "./tool-runtime.js";
import type {
  ApproverFn,
} from "./tool-runtime.js";
import type {
  ApprovalDecision,
  ConversationState,
  RuntimeErrorEvent,
  RuntimeEvent,
  RuntimeOutput,
  ToolDefinition,
  ToolExecutor,
  ToolIntent
} from "./contracts.js";

export interface AgentRuntimeArgs {
  model: string;
  systemPrompt?: string;
  baseMessages?: ChatMessage[];
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  eventBus?: EventBus;

  /** 新架构：通过 registry + hookKernel 注入能力 */
  registry?: CapabilityRegistry;
  hookKernel?: HookKernel;

  /** 旧架构（fallback/fake）：直接注入 */
  provider?: LlmProvider;
  tools?: ToolDefinition[];
  toolExecutors?: ToolExecutor[];
  approver?: ApproverFn;
}

export interface UserInput {
  text: string;
}

export class AgentRuntime {
  private readonly eventBus: EventBus;
  private readonly toolRegistry: ToolRegistry;
  private readonly executorMap: Map<string, ToolExecutor>;
  private readonly approver: ApproverFn | undefined;
  private readonly provider: LlmProvider;
  private readonly registry?: CapabilityRegistry;
  private readonly hookKernel?: HookKernel;

  constructor(private readonly args: AgentRuntimeArgs) {
    this.eventBus = args.eventBus ?? new EventBus();
    this.registry = args.registry;
    this.hookKernel = args.hookKernel;

    // Resolve provider: registry → direct fallback
    if (args.registry) {
      const registered = args.registry.getActiveProvider();
      if (!registered) {
        throw new Error("No active provider available in registry.");
      }
      this.provider = registered.provider;

      // Build tool registry from registry
      const defs = args.registry.getVisibleToolDefinitions();
      this.toolRegistry = new ToolRegistry(defs);

      // Build executor map from registry
      this.executorMap = args.registry.getExecutorMap();

      // Approver wraps HookKernel
      if (args.hookKernel) {
        this.approver = createApproverFromHookKernel(args.hookKernel);
      } else {
        this.approver = undefined;
      }
    } else {
      // Fallback: use directly injected params
      if (!args.provider) {
        throw new Error("Either registry or provider must be provided.");
      }
      this.provider = args.provider;
      this.toolRegistry = new ToolRegistry(args.tools ?? []);

      this.executorMap = new Map();
      if (args.toolExecutors) {
        for (const executor of args.toolExecutors) {
          this.executorMap.set(executor.name, executor);
        }
      }
      this.approver = args.approver;
    }
  }

  async *send(input: UserInput): AsyncIterable<RuntimeOutput> {
    const runId = randomUUID();
    this.eventBus.append({ type: "user.message", runId, text: input.text });
    this.eventBus.append({ type: "run.started", runId });
    yield { type: "status", status: "running" };

    // Build initial message list from current state
    const messages = this.buildInitialMessages(input.text);

    // If no tool executors are configured, fall back to single-turn behavior
    if (this.executorMap.size === 0) {
      yield* this.singleTurnSend(runId, messages);
      return;
    }

    // Multi-turn loop: each iteration calls the provider once
    while (true) {
      const request: ChatRequest = {
        model: this.args.model,
        messages,
        tools: this.buildToolSpecs(),
        temperature: this.args.temperature,
        maxOutputTokens: this.args.maxOutputTokens,
        abortSignal: this.args.abortSignal,
        metadata: { sessionId: runId, turnId: runId }
      };

      let text = "";
      let sawToolIntent = false;
      let lastIntent: ToolIntent | undefined;
      let toolExecuted = false;

      for await (const event of this.provider.stream(request)) {
        if (this.args.abortSignal?.aborted) {
          const error = runtimeError("aborted", "Run was aborted.", false);
          this.eventBus.append({ type: "runtime.error", runId, error });
          this.eventBus.append({ type: "run.finished", runId, status: "aborted", reason: "aborted" });
          yield { type: "error", error };
          return;
        }

        switch (event.type) {
          case "model.started":
            break;

          case "model.text_delta":
            text += event.text;
            this.eventBus.append({ type: "model.text.delta", runId, text: event.text });
            yield { type: "text.delta", text: event.text };
            break;

          case "tool_intent.proposed": {
            const intentOrError = toToolIntent(event, this.provider.name);
            if (intentOrError.error) {
              this.eventBus.append({ type: "runtime.error", runId, error: intentOrError.error });
              this.eventBus.append({ type: "run.finished", runId, status: "failed", reason: "invalid_tool_intent" });
              yield { type: "error", error: intentOrError.error };
              return;
            }
            sawToolIntent = true;
            lastIntent = intentOrError.intent;
            this.eventBus.append({ type: "model.tool.intent", runId, intent: lastIntent });
            yield { type: "tool.intent", intent: lastIntent };
            break;
          }

          case "model.finished":
            if (event.usage) {
              this.eventBus.append({ type: "model.usage", runId, usage: event.usage });
            }

            if (sawToolIntent && lastIntent) {
              // === Execute the 5-stage tool pipeline ===
              const result = await handleToolIntent({
                intent: lastIntent,
                executorMap: this.executorMap,
                approver: this.approver,
                abortSignal: this.args.abortSignal
              });

              // Append all pipeline events to the event bus
              const pipelineEvents = result.events;
              if (pipelineEvents.validation) {
                this.eventBus.append(pipelineEvents.validation);
              }
              if (pipelineEvents.approval) {
                this.eventBus.append(pipelineEvents.approval);
              }
              if (pipelineEvents.executionStarted) {
                this.eventBus.append(pipelineEvents.executionStarted);
              }
              if (pipelineEvents.executionCompleted) {
                this.eventBus.append(pipelineEvents.executionCompleted);
              }
              this.eventBus.append(pipelineEvents.observation);

              // Rebuild messages from updated state
              const updatedState = reduceConversationState(this.eventBus.snapshot());
              messages.length = 0;
              if (this.args.systemPrompt) {
                messages.push({ role: "system", content: this.args.systemPrompt });
              }
              if (this.args.baseMessages) {
                messages.push(...this.args.baseMessages);
              }
              messages.push(...updatedState.messages);

              toolExecuted = true;
              break; // break switch
            }

            // No tool intent — final answer
            if (!sawToolIntent) {
              this.eventBus.append({ type: "model.final", runId, reason: event.stopReason, text });
              this.eventBus.append({ type: "run.finished", runId, status: "completed", reason: event.stopReason });
              yield { type: "status", status: "completed" };
              return;
            }

            // Tool intent but no lastIntent — fallback
            this.eventBus.append({ type: "run.finished", runId, status: "waiting_for_tool", reason: event.stopReason });
            yield { type: "status", status: "waiting_for_tool" };
            return;

          case "provider.error": {
            const error = providerRuntimeError(event.error);
            this.eventBus.append({ type: "runtime.error", runId, error });
            this.eventBus.append({ type: "run.finished", runId, status: "failed", reason: event.error.kind });
            yield { type: "error", error };
            return;
          }
        }

        if (toolExecuted) break;
      }

      if (toolExecuted) {
        toolExecuted = false;
        continue;
      }

      if (text) {
        this.eventBus.append({ type: "model.final", runId, text });
      }
      this.eventBus.append({ type: "run.finished", runId, status: "completed" });
      yield { type: "status", status: "completed" };
      return;
    }
  }

  private async *singleTurnSend(runId: string, messages: ChatMessage[]): AsyncIterable<RuntimeOutput> {
    const request: ChatRequest = {
      model: this.args.model,
      messages,
      tools: this.buildToolSpecs(),
      temperature: this.args.temperature,
      maxOutputTokens: this.args.maxOutputTokens,
      abortSignal: this.args.abortSignal,
      metadata: { sessionId: runId, turnId: runId }
    };

    let text = "";
    let sawToolIntent = false;

    for await (const event of this.provider.stream(request)) {
      if (this.args.abortSignal?.aborted) {
        const error = runtimeError("aborted", "Run was aborted.", false);
        this.eventBus.append({ type: "runtime.error", runId, error });
        this.eventBus.append({ type: "run.finished", runId, status: "aborted", reason: "aborted" });
        yield { type: "error", error };
        return;
      }

      switch (event.type) {
        case "model.started":
          break;

        case "model.text_delta":
          text += event.text;
          this.eventBus.append({ type: "model.text.delta", runId, text: event.text });
          yield { type: "text.delta", text: event.text };
          break;

        case "tool_intent.proposed": {
          const intentOrError = toToolIntent(event, this.provider.name);
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

        case "model.finished":
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

        case "provider.error": {
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

  private buildInitialMessages(userText: string): ChatMessage[] {
    const messages: ChatMessage[] = [];
    if (this.args.systemPrompt) {
      messages.push({ role: "system", content: this.args.systemPrompt });
    }
    if (this.args.baseMessages) {
      messages.push(...this.args.baseMessages);
    }
    messages.push({ role: "user", content: userText });
    return messages;
  }

  private buildToolSpecs() {
    return this.toolRegistry.visibleTools().map((tool) => ({
      // 给模型看短名（如 bash），内部全名（builtin/local-tools/bash）在 lookup 时做映射
      name: shortName(tool.name),
      description: tool.description,
      inputSchema: tool.inputSchema
    }));
  }
}

function runtimeError(code: RuntimeErrorEvent["code"], message: string, retryable: boolean): RuntimeErrorEvent {
  return { code, message, retryable };
}

function toToolIntent(
  event: Extract<ModelEvent, { type: "tool_intent.proposed" }>,
  _provider: string
): { intent: ToolIntent; error?: never } | { intent?: never; error: RuntimeErrorEvent } {
  // 00-12: input 已在 Provider Runtime 中解析，这里只需验证和包装
  if (!isRecord(event.input)) {
    return { error: runtimeError("invalid_tool_intent", `Tool intent input for ${event.toolName} must be a JSON object.`, true) };
  }
  return {
    intent: {
      intentId: randomUUID(),
      toolName: event.toolName,
      input: event.input as Record<string, unknown>,
      providerRef: {
        provider: event.provider,
        rawId: event.providerCallId
      }
    }
  };
}

function providerRuntimeError(error: ProviderError): RuntimeErrorEvent {
  return {
    code: "provider_error",
    message: error.message,
    retryable: error.retryable,
    providerError: error
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * 将 HookKernel 的 runPreToolUse 适配为 handleToolIntent 需要的 ApproverFn。
 */
function createApproverFromHookKernel(hookKernel: HookKernel): ApproverFn {
  return async function hookApprover(intent: ToolIntent, _executor: ToolExecutor): Promise<ApprovalDecision> {
    const decision = await hookKernel.runPreToolUse(intent);
    switch (decision.type) {
      case "allow":
        return { type: "allow", reason: decision.reason };
      case "deny":
        return { type: "deny", reason: decision.reason };
      case "ask":
        return {
          type: "deny",
          reason: `Hook requires user confirmation: ${decision.question}. Use interactive mode to approve.`
        };
    }
  };
}

/**
 * 从内部全名中提取短名（最后一段）。
 * 例：builtin/local-tools/bash → bash
 */
function shortName(internalName: string): string {
  return internalName.split("/").pop() ?? internalName;
}
