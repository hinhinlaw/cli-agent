import type { ChatRequest, ChatResult, LlmProvider, ModelEvent } from "./contract.js";

export class FakeStreamingProvider implements LlmProvider {
  name = "fake";

  async chat(): Promise<ChatResult> {
    return {
      text: "测试失败需要先收集日志。",
      usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 },
      stopReason: "end_turn"
    };
  }

  async *stream(request: ChatRequest): AsyncIterable<ModelEvent> {
    yield { type: "message_start", provider: this.name, model: request.model };
    yield { type: "text_delta", text: "测试" };
    yield { type: "text_delta", text: "失败" };
    yield { type: "text_delta", text: "需要先收集日志。" };
    yield {
      type: "message_stop",
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 }
    };
  }
}
