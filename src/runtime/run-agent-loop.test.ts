import assert from "node:assert/strict";
import test from "node:test";
import type { ChatRequest, ChatResult, LlmProvider, ModelEvent } from "../providers/contract.js";
import { createEchoTool, runAgentLoop, type ToolRegistry } from "./run-agent-loop.js";

const userMessages = [{ role: "user" as const, content: "帮我看看测试为什么失败，并把它修好。" }];

test("runAgentLoop finishes when the model returns a final answer", async () => {
  const provider = new ScriptedProvider(() => [
    { type: "message_start", provider: "test", model: "test-model" },
    { type: "text_delta", text: "已完成。" },
    { type: "message_stop", stopReason: "end_turn" }
  ]);

  const result = await runAgentLoop({
    model: provider,
    modelName: "test-model",
    messages: userMessages,
    toolRegistry: {},
    maxTurns: 3
  });

  assert.equal(result.stopReason, "final");
  assert.equal(result.finalAnswer, "已完成。");
  assert.deepEqual(result.newMessages, [{ role: "assistant", content: "已完成。" }]);
  assert.deepEqual(
    result.events.map((event) => event.type),
    ["turn_start", "assistant_message", "final"]
  );
});

test("runAgentLoop feeds tool observation into the next model turn", async () => {
  const seenRequests: ChatRequest[] = [];
  const provider = new ScriptedProvider((request) => {
    seenRequests.push(request);
    const sawObservation = request.messages.some((message) => message.content.includes("Observation: fake_test succeeded"));
    if (sawObservation) {
      return [
        { type: "message_start", provider: "test", model: request.model },
        { type: "text_delta", text: "测试已经通过。" },
        { type: "message_stop", stopReason: "end_turn" }
      ];
    }
    return [
      { type: "message_start", provider: "test", model: request.model },
      { type: "tool_intent", name: "fake_test", argumentsText: "{\"command\":\"npm test\"}" },
      { type: "message_stop", stopReason: "tool_use" }
    ];
  });
  const toolRegistry: ToolRegistry = {
    fake_test: {
      execute(input) {
        return {
          ok: true,
          summary: `ran ${String(input.command)}`,
          evidence: "1 test passed"
        };
      }
    }
  };

  const result = await runAgentLoop({
    model: provider,
    modelName: "test-model",
    systemPrompt: "你是一个最小 Agent Loop。",
    tools: [{ name: "fake_test", description: "run fake tests" }],
    messages: userMessages,
    toolRegistry,
    maxTurns: 4
  });

  assert.equal(result.stopReason, "final");
  assert.equal(result.finalAnswer, "测试已经通过。");
  assert.equal(seenRequests.length, 2);
  assert.match(seenRequests[1].messages.at(-1)?.content ?? "", /Observation: fake_test succeeded/);
  assert.deepEqual(
    result.events.map((event) => event.type),
    ["turn_start", "assistant_message", "tool_intent", "observation", "turn_start", "assistant_message", "final"]
  );
});

test("runAgentLoop turns unknown tools into observations instead of executing them", async () => {
  const provider = new ScriptedProvider((request) => {
    const sawUnknownToolObservation = request.messages.some((message) => message.content.includes("Unknown tool: missing_tool"));
    if (sawUnknownToolObservation) {
      return [
        { type: "message_start", provider: "test", model: request.model },
        { type: "text_delta", text: "无法继续，因为工具不存在。" },
        { type: "message_stop", stopReason: "end_turn" }
      ];
    }
    return [
      { type: "message_start", provider: "test", model: request.model },
      { type: "tool_intent", name: "missing_tool", argumentsText: "{}" },
      { type: "message_stop", stopReason: "tool_use" }
    ];
  });

  const result = await runAgentLoop({
    model: provider,
    modelName: "test-model",
    messages: userMessages,
    toolRegistry: {},
    maxTurns: 3
  });

  assert.equal(result.stopReason, "final");
  assert.match(result.newMessages[1].content, /Unknown tool: missing_tool/);
  assert.equal(result.events.find((event) => event.type === "observation")?.type, "observation");
});

test("runAgentLoop turns malformed tool arguments into retryable observations", async () => {
  const provider = new ScriptedProvider((request) => {
    const sawInvalidIntent = request.messages.some((message) => message.content.includes("invalid_tool_intent"));
    if (sawInvalidIntent) {
      return [
        { type: "message_start", provider: "test", model: request.model },
        { type: "text_delta", text: "我会改用 final 结束。" },
        { type: "message_stop", stopReason: "end_turn" }
      ];
    }
    return [
      { type: "message_start", provider: "test", model: request.model },
      { type: "tool_intent", name: "echo", argumentsText: "not-json" },
      { type: "message_stop", stopReason: "tool_use" }
    ];
  });

  const result = await runAgentLoop({
    model: provider,
    modelName: "test-model",
    messages: userMessages,
    toolRegistry: { echo: createEchoTool() },
    maxTurns: 3
  });

  assert.equal(result.stopReason, "final");
  assert.match(result.newMessages[1].content, /errorType: invalid_tool_intent/);
  assert.match(result.newMessages[1].content, /retryable: true/);
});

test("runAgentLoop stops at maxTurns after feeding the latest observation", async () => {
  const provider = new ScriptedProvider(() => [
    { type: "message_start", provider: "test", model: "test-model" },
    { type: "tool_intent", name: "echo", argumentsText: "{\"text\":\"still working\"}" },
    { type: "message_stop", stopReason: "tool_use" }
  ]);

  const result = await runAgentLoop({
    model: provider,
    modelName: "test-model",
    messages: userMessages,
    toolRegistry: { echo: createEchoTool() },
    maxTurns: 1
  });

  assert.equal(result.stopReason, "max_turns_exceeded");
  assert.match(result.newMessages.at(-1)?.content ?? "", /echo: still working/);
  assert.deepEqual(result.events.at(-1), { type: "stop", turn: 1, reason: "max_turns_exceeded" });
});

class ScriptedProvider implements LlmProvider {
  name = "test";

  constructor(private readonly nextEvents: (request: ChatRequest) => ModelEvent[]) {}

  async chat(): Promise<ChatResult> {
    return { text: "" };
  }

  async *stream(request: ChatRequest): AsyncIterable<ModelEvent> {
    for (const event of this.nextEvents(request)) {
      yield event;
    }
  }
}
