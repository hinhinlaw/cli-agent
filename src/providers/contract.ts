export type Role = "system" | "user" | "assistant";

export interface ChatMessage {
  role: Role;
  content: string;
}

/**
 * Provider contract
 * 统一的数据格式，作为当前系统和 LLM 供应商之间的“翻译”层
 * 用户输入 -> LLM 时，从 ChatRequest 转换成 LLM 供应商的 API 格式
 * LLM -> 系统时，将不同 LLM 供应商的响应翻译回系统能识别的数据格式
 */
export interface ChatRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ChatToolSpec[];
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  metadata?: {
    sessionId?: string;
    turnId?: string;
  };
}

export interface ChatToolSpec {
  name: string;
  description?: string;
  inputSchema?: unknown;
}

/**
 * 模型事件（Provider Runtime 归一化输出）
 *
 * 00-12 重命名规则：
 * - model.*   → 模型自身的生命周期事件
 * - tool_intent.* → 模型提出的工具调用意图
 * - provider.* → provider 层自身错误
 *
 * Provider Runtime 只产出事件，不执行工具。
 */
export type ModelEvent =
  | { type: "model.started"; provider: string; model: string }
  | { type: "model.text_delta"; text: string }
  | { type: "model.finished"; usage?: TokenUsage; stopReason?: string }
  | { type: "tool_intent.delta"; providerCallId: string; toolName?: string; rawInputText: string }
  | { type: "tool_intent.proposed"; id: string; toolName: string; input: unknown; providerCallId?: string; provider: string; model: string }
  | { type: "provider.error"; error: ProviderError };

export interface TokenUsage {
  inputTokens?: number;
  outputTokens?: number;
  totalTokens?: number;
}

export type ProviderErrorKind =
  | "auth"
  | "permission"
  | "rate_limit"
  | "quota"
  | "invalid_request"
  | "context_length"
  | "timeout"
  | "network"
  | "overloaded"
  | "server"
  | "unknown";

/**
 * 统一定义的 Provider 层的错误
 * 因为错误有很多种原因，比如 API KEY 认证问题、额度问题、请求超时等等
 * 这些 Provider 内部的错误要统一格式输出到 Provider 的外部，这样系统中的其他部件才能“可穷举”地处理Provider的错误情况，从而决定下一步
 */
export interface ProviderError {
  kind: ProviderErrorKind;
  retryable: boolean;
  message: string;
  provider: string;
  requestId?: string;
  statusCode?: number;
  cause?: unknown;
}

export interface ChatResult {
  text: string;
  usage?: TokenUsage;
  stopReason?: string;
  raw?: unknown;
}

export interface LlmProvider {
  name: string;
  chat(request: ChatRequest): Promise<ChatResult>;
  stream(request: ChatRequest): AsyncIterable<ModelEvent>;
}
