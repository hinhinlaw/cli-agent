import type { ProviderError, ProviderErrorKind } from "./contract.js";

export class RuntimeError extends Error {
  constructor(
    message: string,
    public readonly providerError?: ProviderError
  ) {
    super(message);
    this.name = "RuntimeError";
  }
}

/**
 * 将 Provider 的错误转换成 Runtime 的错误
 * @param error 
 * @returns 
 */
export function mapProviderErrorToRuntimeError(error: ProviderError): RuntimeError {
  return new RuntimeError(userFacingProviderMessage(error), error);
}

export function userFacingProviderMessage(error: ProviderError): string {
  switch (error.kind) {
    case "auth":
      return "认证失败，请检查模型 API Key。";
    case "permission":
      return "模型权限不足，请检查账号或模型访问权限。";
    case "rate_limit":
      return "模型请求被限流，请稍后重试。";
    case "quota":
      return "模型额度不足，请检查账单或切换 provider。";
    case "context_length":
      return "请求上下文过长，当前里程碑尚未实现上下文压缩。";
    case "timeout":
    case "network":
      return "模型调用遇到网络问题，请稍后重试。";
    case "overloaded":
    case "server":
      return "模型服务暂时不可用，请稍后重试。";
    case "invalid_request":
      return "模型请求格式无效，需要检查 provider adapter。";
    case "unknown":
      return "模型调用失败，需要查看结构化错误信息。";
  }
}

export function providerErrorFromHttp(args: {
  provider: string;
  statusCode: number;
  message: string;
  requestId?: string;
  cause?: unknown;
}): ProviderError {
  const kind = providerErrorKindFromStatus(args.statusCode, args.message);
  return {
    kind,
    retryable: isRetryableProviderError(kind),
    message: args.message,
    provider: args.provider,
    requestId: args.requestId,
    statusCode: args.statusCode,
    cause: args.cause
  };
}

export function providerErrorFromUnknown(provider: string, cause: unknown): ProviderError {
  if (cause instanceof Error && cause.name === "AbortError") {
    return {
      kind: "timeout",
      retryable: true,
      message: "Provider request was aborted.",
      provider,
      cause
    };
  }

  if (cause instanceof TypeError) {
    return {
      kind: "network",
      retryable: true,
      message: cause.message,
      provider,
      cause
    };
  }

  return {
    kind: "unknown",
    retryable: false,
    message: cause instanceof Error ? cause.message : "Unknown provider error.",
    provider,
    cause
  };
}

function providerErrorKindFromStatus(statusCode: number, message: string): ProviderErrorKind {
  const lowerMessage = message.toLowerCase();

  if (statusCode === 401) return "auth";
  if (statusCode === 403) return "permission";
  if (statusCode === 408) return "timeout";
  if (statusCode === 413 || lowerMessage.includes("context")) return "context_length";
  if (statusCode === 429) {
    return lowerMessage.includes("quota") || lowerMessage.includes("billing") ? "quota" : "rate_limit";
  }
  if (statusCode >= 500) return statusCode === 503 ? "overloaded" : "server";
  if (statusCode >= 400) return "invalid_request";

  return "unknown";
}

function isRetryableProviderError(kind: ProviderErrorKind): boolean {
  return kind === "rate_limit" || kind === "timeout" || kind === "network" || kind === "overloaded" || kind === "server";
}
