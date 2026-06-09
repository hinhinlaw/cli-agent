import { randomUUID } from "node:crypto";
import type { ChatMessage, ChatRequest, LlmProvider, ModelEvent, TokenUsage } from "../providers/contract.js";
import { mapProviderErrorToRuntimeError } from "../providers/errors.js";

export interface AgentToolSpec {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

export interface ToolIntent {
  name: string;
  input: Record<string, unknown>;
  id?: string;
}

export interface ToolResult {
  ok: boolean;
  summary: string;
  evidence?: string;
  errorType?: string;
  retryable?: boolean;
}

export interface Observation extends ToolResult {
  toolName: string;
}

export interface AgentTool {
  execute(input: Record<string, unknown>, intent: ToolIntent): Promise<ToolResult> | ToolResult;
}

export type ToolRegistry = Record<string, AgentTool>;

export type AgentLoopEvent =
  | { type: "turn_start"; turn: number }
  | { type: "assistant_message"; turn: number; content: string; usage?: TokenUsage; stopReason?: string }
  | { type: "tool_intent"; turn: number; intent: ToolIntent }
  | { type: "observation"; turn: number; observation: Observation }
  | { type: "final"; turn: number; answer: string }
  | { type: "stop"; turn: number; reason: AgentLoopStopReason };

export type AgentLoopStopReason = "final" | "max_turns_exceeded" | "aborted";

export interface RunAgentLoopArgs {
  model: LlmProvider;
  modelName: string;
  messages: ChatMessage[];
  systemPrompt?: string;
  tools?: AgentToolSpec[];
  toolRegistry: ToolRegistry;
  maxTurns?: number;
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
}

export interface RunAgentLoopResult {
  newMessages: ChatMessage[];
  events: AgentLoopEvent[];
  finalAnswer?: string;
  stopReason: AgentLoopStopReason;
}

interface AssistantDecision {
  text: string;
  toolIntent?: ToolIntent;
  invalidToolIntentObservation?: Observation;
  usage?: TokenUsage;
  stopReason?: string;
}

const DEFAULT_MAX_TURNS = 8;

export async function runAgentLoop(args: RunAgentLoopArgs): Promise<RunAgentLoopResult> {
  const maxTurns = args.maxTurns ?? DEFAULT_MAX_TURNS;
  const newMessages: ChatMessage[] = [];
  const events: AgentLoopEvent[] = [];
  let turn = 0;

  while (!args.abortSignal?.aborted) {
    if (turn >= maxTurns) {
      events.push({ type: "stop", turn, reason: "max_turns_exceeded" });
      return { newMessages, events, stopReason: "max_turns_exceeded" };
    }

    events.push({ type: "turn_start", turn });

    const request = buildChatRequest(args, newMessages, turn);
    const decision = await collectAssistantDecision(args.model.stream(request));

    if (decision.toolIntent || decision.invalidToolIntentObservation) {
      const assistantMessage = decision.toolIntent
        ? toolIntentMessage(decision.toolIntent, decision.text)
        : invalidToolIntentMessage(decision.invalidToolIntentObservation, decision.text);
      newMessages.push(assistantMessage);
      events.push({
        type: "assistant_message",
        turn,
        content: assistantMessage.content,
        usage: decision.usage,
        stopReason: decision.stopReason
      });
      if (decision.toolIntent) {
        events.push({ type: "tool_intent", turn, intent: decision.toolIntent });
      }

      let observation: Observation;
      if (decision.invalidToolIntentObservation) {
        observation = decision.invalidToolIntentObservation;
      } else if (decision.toolIntent) {
        observation = await executeIntent(decision.toolIntent, args.toolRegistry);
      } else {
        throw new Error("Agent loop decision entered tool branch without an intent.");
      }
      newMessages.push(observationMessage(observation));
      events.push({ type: "observation", turn, observation });
      turn += 1;
      continue;
    }

    const finalMessage: ChatMessage = { role: "assistant", content: decision.text };
    newMessages.push(finalMessage);
    events.push({
      type: "assistant_message",
      turn,
      content: finalMessage.content,
      usage: decision.usage,
      stopReason: decision.stopReason
    });
    events.push({ type: "final", turn, answer: decision.text });
    return { newMessages, events, finalAnswer: decision.text, stopReason: "final" };
  }

  events.push({ type: "stop", turn, reason: "aborted" });
  return { newMessages, events, stopReason: "aborted" };
}

export function createEchoTool(): AgentTool {
  return {
    execute(input) {
      return {
        ok: true,
        summary: `echo: ${String(input.text ?? "")}`
      };
    }
  };
}

function buildChatRequest(args: RunAgentLoopArgs, newMessages: ChatMessage[], turn: number): ChatRequest {
  return {
    model: args.modelName,
    messages: buildLoopMessages(args.systemPrompt, args.tools ?? [], args.messages, newMessages),
    temperature: args.temperature,
    maxOutputTokens: args.maxOutputTokens,
    abortSignal: args.abortSignal,
    metadata: {
      turnId: randomUUID(),
      sessionId: `agent-loop-${turn}`
    }
  };
}

function buildLoopMessages(
  systemPrompt: string | undefined,
  tools: AgentToolSpec[],
  baseMessages: ChatMessage[],
  newMessages: ChatMessage[]
): ChatMessage[] {
  const systemMessages: ChatMessage[] = [];
  if (systemPrompt) {
    systemMessages.push({ role: "system", content: systemPrompt });
  }
  if (tools.length > 0) {
    systemMessages.push({ role: "system", content: toolCatalogMessage(tools) });
  }
  return [...systemMessages, ...baseMessages, ...newMessages];
}

function toolCatalogMessage(tools: AgentToolSpec[]): string {
  const lines = tools.map((tool) => {
    const schema = tool.inputSchema === undefined ? "" : ` inputSchema=${JSON.stringify(tool.inputSchema)}`;
    const description = tool.description === undefined ? "" : ` - ${tool.description}`;
    return `- ${tool.name}${description}${schema}`;
  });
  return `Available tools:\n${lines.join("\n")}`;
}

async function collectAssistantDecision(events: AsyncIterable<ModelEvent>): Promise<AssistantDecision> {
  let text = "";
  let toolIntent: ToolIntent | undefined;
  let usage: TokenUsage | undefined;
  let stopReason: string | undefined;

  for await (const event of events) {
    switch (event.type) {
      case "message_start":
        break;

      case "text_delta":
        text += event.text;
        break;

      case "tool_intent":
        try {
          toolIntent = parseToolIntent(event);
        } catch (error) {
          return {
            text,
            invalidToolIntentObservation: {
              toolName: event.name,
              ok: false,
              summary: error instanceof Error ? error.message : "Tool intent arguments are invalid.",
              errorType: "invalid_tool_intent",
              retryable: true
            }
          };
        }
        break;

      case "message_stop":
        usage = event.usage;
        stopReason = event.stopReason;
        return { text, toolIntent, usage, stopReason };

      case "error":
        throw mapProviderErrorToRuntimeError(event.error);
    }
  }

  return { text, toolIntent, usage, stopReason };
}

function parseToolIntent(event: Extract<ModelEvent, { type: "tool_intent" }>): ToolIntent {
  const parsed = JSON.parse(event.argumentsText) as unknown;
  if (!isRecord(parsed)) {
    throw new Error(`Tool intent arguments for ${event.name} must be a JSON object.`);
  }
  return {
    name: event.name,
    input: parsed,
    id: event.id
  };
}

async function executeIntent(intent: ToolIntent, toolRegistry: ToolRegistry): Promise<Observation> {
  const tool = toolRegistry[intent.name];
  if (!tool) {
    return {
      toolName: intent.name,
      ok: false,
      summary: `Unknown tool: ${intent.name}`,
      errorType: "unknown_tool",
      retryable: false
    };
  }

  try {
    const result = await tool.execute(intent.input, intent);
    return {
      toolName: intent.name,
      ...result
    };
  } catch (error) {
    return {
      toolName: intent.name,
      ok: false,
      summary: error instanceof Error ? error.message : "Tool execution failed.",
      errorType: "tool_error",
      retryable: false
    };
  }
}

function toolIntentMessage(intent: ToolIntent, text: string): ChatMessage {
  const prefix = text.trim().length > 0 ? `${text.trim()}\n` : "";
  return {
    role: "assistant",
    content: `${prefix}Tool intent: ${intent.name} ${JSON.stringify(intent.input)}`
  };
}

function invalidToolIntentMessage(observation: Observation | undefined, text: string): ChatMessage {
  const prefix = text.trim().length > 0 ? `${text.trim()}\n` : "";
  return {
    role: "assistant",
    content: `${prefix}Invalid tool intent: ${observation?.toolName ?? "unknown"}`
  };
}

function observationMessage(observation: Observation): ChatMessage {
  const lines = [
    `Observation: ${observation.toolName} ${observation.ok ? "succeeded" : "failed"}`,
    `summary: ${observation.summary}`
  ];
  if (observation.evidence) lines.push(`evidence: ${observation.evidence}`);
  if (observation.errorType) lines.push(`errorType: ${observation.errorType}`);
  if (observation.retryable !== undefined) lines.push(`retryable: ${observation.retryable}`);
  return {
    role: "user",
    content: lines.join("\n")
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
