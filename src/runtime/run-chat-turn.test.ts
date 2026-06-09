import assert from "node:assert/strict";
import test from "node:test";
import type { ChatRequest, ChatResult, LlmProvider, ModelEvent } from "../providers/contract.js";
import { FakeStreamingProvider } from "../providers/fake.js";
import { RuntimeError } from "../providers/errors.js";
import { runChatTurn } from "./run-chat-turn.js";

const messages = [{ role: "user" as const, content: "帮我看看测试为什么失败。" }];

test("runChatTurn prints all fake provider text deltas", async () => {
  const deltas: string[] = [];

  const result = await runChatTurn({
    provider: new FakeStreamingProvider(),
    model: "fake-model",
    messages,
    onTextDelta(delta) {
      deltas.push(delta);
    }
  });

  assert.deepEqual(deltas, ["测试", "失败", "需要先收集日志。"]);
  assert.equal(result.text, "测试失败需要先收集日志。");
  assert.equal(result.stopReason, "end_turn");
  assert.deepEqual(result.usage, { inputTokens: 10, outputTokens: 8, totalTokens: 18 });
});

test("runChatTurn stops when message_stop is emitted", async () => {
  const provider = new EventsProvider([
    { type: "message_start", provider: "test", model: "test-model" },
    { type: "text_delta", text: "before stop" },
    { type: "message_stop", stopReason: "end_turn" },
    { type: "text_delta", text: "after stop" }
  ]);
  const deltas: string[] = [];

  const result = await runChatTurn({
    provider,
    model: "test-model",
    messages,
    onTextDelta(delta) {
      deltas.push(delta);
    }
  });

  assert.deepEqual(deltas, ["before stop"]);
  assert.equal(result.text, "before stop");
});

test("runChatTurn rejects tool_intent because Tool Runtime is not enabled", async () => {
  const provider = new EventsProvider([
    { type: "message_start", provider: "test", model: "test-model" },
    { type: "tool_intent", name: "read_file", argumentsText: "{\"path\":\"package.json\"}" }
  ]);

  await assert.rejects(
    () =>
      runChatTurn({
        provider,
        model: "test-model",
        messages,
        onTextDelta() {}
      }),
    (error) => error instanceof RuntimeError && error.message.includes("Tool Runtime is not enabled")
  );
});

test("runChatTurn maps ProviderError into RuntimeError", async () => {
  const provider = new EventsProvider([
    {
      type: "error",
      error: {
        kind: "auth",
        retryable: false,
        message: "bad key",
        provider: "test",
        statusCode: 401
      }
    }
  ]);

  await assert.rejects(
    () =>
      runChatTurn({
        provider,
        model: "test-model",
        messages,
        onTextDelta() {}
      }),
    (error) =>
      error instanceof RuntimeError &&
      error.message.includes("认证失败") &&
      error.providerError?.kind === "auth"
  );
});

class EventsProvider implements LlmProvider {
  name = "test";

  constructor(private readonly events: ModelEvent[]) {}

  async chat(): Promise<ChatResult> {
    return { text: "" };
  }

  async *stream(_request: ChatRequest): AsyncIterable<ModelEvent> {
    for (const event of this.events) {
      yield event;
    }
  }
}
