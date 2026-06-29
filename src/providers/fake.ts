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
    yield { type: "model.started", provider: this.name, model: request.model };
    yield { type: "model.text_delta", text: "测试" };
    yield { type: "model.text_delta", text: "失败" };
    yield { type: "model.text_delta", text: "需要先收集日志。" };
    yield {
      type: "model.finished",
      stopReason: "end_turn",
      usage: { inputTokens: 10, outputTokens: 8, totalTokens: 18 }
    };
  }
}

export class FakeAgentLoopProvider implements LlmProvider {
  name = "fake-agent-loop";

  async chat(): Promise<ChatResult> {
    return { text: "fake agent loop uses stream events." };
  }

  async *stream(request: ChatRequest): AsyncIterable<ModelEvent> {
    const observationText = request.messages
      .filter((message) => message.content.startsWith("Observation:"))
      .map((message) => message.content)
      .join("\n\n");

    yield { type: "model.started", provider: this.name, model: request.model };

    if (!observationText.includes("fake_test")) {
      yield {
        type: "model.text_delta",
        text: "我需要先复现测试失败。"
      };
      yield { type: "tool_intent.proposed", id: "fake-1", toolName: "fake_test", input: {}, provider: this.name, model: request.model };
      yield { type: "model.finished", stopReason: "tool_use" };
      return;
    }

    if (observationText.includes("actual 3") && !observationText.includes("Read src/sum.ts")) {
      yield {
        type: "model.text_delta",
        text: "失败集中在负数加法分支，我需要读取 src/sum.ts。"
      };
      yield { type: "tool_intent.proposed", id: "fake-2", toolName: "fake_read_file", input: { path: "src/sum.ts" }, provider: this.name, model: request.model };
      yield { type: "model.finished", stopReason: "tool_use" };
      return;
    }

    if (observationText.includes("return a + b - 1") && !observationText.includes("Replaced the broken negative branch")) {
      yield {
        type: "model.text_delta",
        text: "sum.ts 的负数分支多减了 1，我会修掉这个分支。"
      };
      yield {
        type: "tool_intent.proposed",
        id: "fake-3",
        toolName: "fake_edit_file",
        input: { path: "src/sum.ts", operation: "replace_with_a_plus_b" },
        provider: this.name,
        model: request.model
      };
      yield { type: "model.finished", stopReason: "tool_use" };
      return;
    }

    if (observationText.includes("Replaced the broken negative branch") && !observationText.includes("2 tests passed")) {
      yield {
        type: "model.text_delta",
        text: "修改完成后需要重新运行测试验证。"
      };
      yield { type: "tool_intent.proposed", id: "fake-4", toolName: "fake_test", input: {}, provider: this.name, model: request.model };
      yield { type: "model.finished", stopReason: "tool_use" };
      return;
    }

    yield {
      type: "model.text_delta",
      text: "已修复失败测试。问题是 src/sum.ts 的负数分支返回了 a + b - 1，导致 sum(-1, 5) 得到 3；修复后重新运行测试，2 个测试全部通过。"
    };
    yield { type: "model.finished", stopReason: "end_turn" };
  }
}
