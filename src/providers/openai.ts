import type { ChatMessage, ChatRequest, ChatResult, LlmProvider, ModelEvent, TokenUsage } from "./contract.js";
import { providerErrorFromHttp, providerErrorFromUnknown } from "./errors.js";

export interface OpenAIProviderConfig {
  apiKey: string;
  baseUrl?: string;
}

interface OpenAIChatCompletionChunk {
  id?: string;
  model?: string;
  choices?: Array<{
      delta?: {
        content?: string;
        tool_calls?: Array<{
          index?: number;
          id?: string;
          function?: {
            name?: string;
          arguments?: string;
        };
      }>;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
  error?: {
    message?: string;
  };
}

interface OpenAIChatCompletionResponse {
  choices?: Array<{
    message?: {
      content?: string | null;
    };
    finish_reason?: string;
  }>;
  usage?: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  };
}

/**
 * OpenAI 协议翻译
 */
export class OpenAIProvider implements LlmProvider {
  name = "openai";

  private readonly baseUrl: string;

  constructor(private readonly config: OpenAIProviderConfig) {
    // this.baseUrl = config.baseUrl ?? "https://api.openai.com/v1";
    this.baseUrl = config.baseUrl ?? "https://muyuan.do/v1";
  }

  async chat(request: ChatRequest): Promise<ChatResult> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(this.toOpenAIRequest(request, false)),
        signal: request.abortSignal
      });

      if (!response.ok) {
        throw await this.toProviderError(response);
      }

      const body = (await response.json()) as OpenAIChatCompletionResponse;
      const choice = body.choices?.[0];

      return {
        text: choice?.message?.content ?? "",
        usage: toTokenUsage(body.usage),
        stopReason: choice?.finish_reason,
        raw: body
      };
    } catch (error) {
      if (isProviderErrorEvent(error)) {
        throw error;
      }
      throw providerErrorFromUnknown(this.name, error);
    }
  }

  async *stream(request: ChatRequest): AsyncIterable<ModelEvent> {
    try {
      const response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: this.headers(),
        body: JSON.stringify(this.toOpenAIRequest(request, true)),
        signal: request.abortSignal
      });

      if (!response.ok) {
        yield { type: "error", error: await this.toProviderError(response) };
        return;
      }

      if (!response.body) {
        yield {
          type: "error",
          error: {
            kind: "unknown",
            retryable: false,
            message: "OpenAI stream response did not include a body.",
            provider: this.name
          }
        };
        return;
      }

      yield { type: "message_start", provider: this.name, model: request.model };

      let stopReason: string | undefined;
      let usage: TokenUsage | undefined;
      const toolCallFragments = new Map<string, { id?: string; name?: string; argumentsText: string }>();
      const toolCallIndexKeys = new Map<number, string>();

      for await (const chunk of readServerSentEvents(response.body)) {
        console.log('>>> chunk',chunk)
        if (chunk === "[DONE]") {
          break;
        }

        const event = parseOpenAIChunk(chunk);
        if (event.error) {
          yield {
            type: "error",
            error: {
              kind: "unknown",
              retryable: false,
              message: event.error.message ?? "OpenAI stream returned an error event.",
              provider: this.name
            }
          };
          return;
        }

        usage = toTokenUsage(event.usage) ?? usage;

        for (const choice of event.choices ?? []) {
          if (choice.delta?.content) {
            yield { type: "text_delta", text: choice.delta.content };
          }

          for (const toolCall of choice.delta?.tool_calls ?? []) {
            const key = toolCall.id ?? (toolCall.index === undefined ? String(toolCallFragments.size) : toolCallIndexKeys.get(toolCall.index) ?? String(toolCall.index));
            if (toolCall.index !== undefined) {
              toolCallIndexKeys.set(toolCall.index, key);
            }
            const current = toolCallFragments.get(key) ?? { argumentsText: "" };
            toolCallFragments.set(key, {
              id: toolCall.id ?? current.id,
              name: toolCall.function?.name ?? current.name,
              argumentsText: current.argumentsText + (toolCall.function?.arguments ?? "")
            });
          }

          stopReason = choice.finish_reason ?? stopReason;
        }
      }

      for (const toolCall of toolCallFragments.values()) {
        yield {
          type: "tool_intent",
          id: toolCall.id,
          name: toolCall.name ?? "unknown",
          argumentsText: toolCall.argumentsText
        };
      }
      yield { type: "message_stop", usage, stopReason };
    } catch (error) {
      yield { type: "error", error: providerErrorFromUnknown(this.name, error) };
    }
  }

  private headers(): Record<string, string> {
    return {
      "content-type": "application/json",
      authorization: `Bearer ${this.config.apiKey}`
    };
  }

  /**
   * 将系统的 Provider contract 翻译成 OpenAI API 的格式
   * @param request 
   * @param stream 
   * @returns 
   */
  private toOpenAIRequest(request: ChatRequest, stream: boolean): Record<string, unknown> {
    return {
      model: request.model,
      messages: request.messages.map(toOpenAIMessage),
      tools: request.tools?.map(toOpenAITool),
      temperature: request.temperature,
      max_tokens: request.maxOutputTokens,
      stream
    };
  }

  /**
   * 将 LLM 的报错翻译成系统能理解的结构化数据
   * @param response 
   * @returns 
   */
  private async toProviderError(response: Response) {
    const requestId = response.headers.get("x-request-id") ?? undefined;
    const body = await readErrorBody(response);
    return providerErrorFromHttp({
      provider: this.name,
      statusCode: response.status,
      message: body,
      requestId,
      cause: body
    });
  }
}

function toOpenAIMessage(message: ChatMessage): Record<string, string> {
  return {
    role: message.role,
    content: message.content
  };
}

function toOpenAITool(tool: NonNullable<ChatRequest["tools"]>[number]): Record<string, unknown> {
  return {
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.inputSchema ?? { type: "object", properties: {} }
    }
  };
}

function toTokenUsage(usage: OpenAIChatCompletionChunk["usage"]): TokenUsage | undefined {
  if (!usage) return undefined;
  return {
    inputTokens: usage.prompt_tokens,
    outputTokens: usage.completion_tokens,
    totalTokens: usage.total_tokens
  };
}

function parseOpenAIChunk(chunk: string): OpenAIChatCompletionChunk {
  return JSON.parse(chunk) as OpenAIChatCompletionChunk;
}

async function* readServerSentEvents(body: ReadableStream<Uint8Array>): AsyncIterable<string> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  while (true) {
    const { value, done } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });
    const messages = buffer.split("\n\n");
    buffer = messages.pop() ?? "";

    for (const message of messages) {
      const dataLines = message
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice("data:".length).trim());

      if (dataLines.length > 0) {
        yield dataLines.join("\n");
      }
    }
  }

  buffer += decoder.decode();
  if (buffer.trim()) {
    const dataLines = buffer
      .split("\n")
      .filter((line) => line.startsWith("data:"))
      .map((line) => line.slice("data:".length).trim());

    if (dataLines.length > 0) {
      yield dataLines.join("\n");
    }
  }
}

async function readErrorBody(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    return body.error?.message ?? JSON.stringify(body);
  } catch {
    return await response.text();
  }
}

function isProviderErrorEvent(error: unknown): boolean {
  return typeof error === "object" && error !== null && "kind" in error && "provider" in error;
}
