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
  temperature?: number;
  maxOutputTokens?: number;
  abortSignal?: AbortSignal;
  metadata?: {
    sessionId?: string;
    turnId?: string;
  };
}

/**
 * 模型事件
 * 系统会将 LLM 的响应统一转换成结构化数据 ModelEvent，而不是将 LLM 响应原封不动输出到系统的其他部件
 * 有了 ModelEvent，就可以将模型的行为的判断收敛到 Provider 层中
 */
export type ModelEvent =
  | { type: "message_start"; provider: string; model: string }
  | { type: "text_delta"; text: string }
  | { type: "message_stop"; usage?: TokenUsage; stopReason?: string }
  | { type: "tool_intent"; name: string; argumentsText: string; id?: string }
  | { type: "error"; error: ProviderError };

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
