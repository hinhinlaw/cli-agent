import assert from "node:assert/strict";
import test from "node:test";
import { AgentRuntime } from "./agent-runtime.js";
import { reduceConversationState } from "./conversation-state.js";
import type { RuntimeEvent, ToolDefinition } from "./contracts.js";
import { runAgentLoop } from "./run-agent-loop.js";
import type { ChatRequest, ChatResult, LlmProvider, ModelEvent } from "../providers/contract.js";

const userText = "帮我看看测试为什么失败，并把它修好。";

test("AgentRuntime records final text as runtime events", async () => {
  const provider = new ScriptedProvider(() => [
    { type: "model.started", provider: "test", model: "test-model" },
    { type: "model.text_delta", text: "已完成。" },
    { type: "model.finished", stopReason: "end_turn", usage: { inputTokens: 2, outputTokens: 3, totalTokens: 5 } }
  ]);
  const runtime = new AgentRuntime({ provider, model: "test-model" });

  const outputs = await collect(runtime.send({ text: userText }));

  assert.deepEqual(outputs, [
    { type: "status", status: "running" },
    { type: "text.delta", text: "已完成。" },
    { type: "status", status: "completed" }
  ]);
  assert.equal(runtime.getState().status, "completed");
  assert.equal(runtime.getState().messages.at(-1)?.content, "已完成。");
  assert.deepEqual(
    runtime.getEvents().map((event) => event.type),
    ["user.message", "run.started", "model.text.delta", "model.usage", "model.final", "run.finished"]
  );
});

test("AgentRuntime records tool intent without executing tools", async () => {
  const seenRequests: ChatRequest[] = [];
  const provider = new ScriptedProvider((request) => {
    seenRequests.push(request);
    return [
      { type: "model.started", provider: "test", model: request.model },
      { type: "model.text_delta", text: "我需要先运行测试。" },
      { type: "tool_intent.proposed", id: "provider-call-1", toolName: "run_tests", input: { command: "npm test" }, provider: "test", model: request.model },
      { type: "model.finished", stopReason: "tool_use" }
    ];
  });
  const runtime = new AgentRuntime({
    provider,
    model: "test-model",
    tools: [runTestsTool()]
  });

  const outputs = await collect(runtime.send({ text: userText }));
  const state = runtime.getState();

  assert.equal(seenRequests.length, 1);
  assert.equal(seenRequests[0].tools?.[0]?.name, "run_tests");
  assert.equal(seenRequests[0].tools?.[0]?.description, "Run the project test suite.");
  assert.deepEqual(
    outputs.map((output) => output.type),
    ["status", "text.delta", "tool.intent", "status"]
  );
  assert.equal(outputs.find((output) => output.type === "tool.intent")?.intent.toolName, "run_tests");
  assert.equal(state.status, "waiting_for_tool");
  assert.equal(state.pendingToolIntents.length, 1);
  assert.deepEqual(state.pendingToolIntents[0].input, { command: "npm test" });
  assert.deepEqual(
    runtime.getEvents().map((event) => event.type),
    ["user.message", "run.started", "model.text.delta", "model.tool.intent", "run.finished"]
  );
});

test("AgentRuntime rejects malformed tool intent arguments as runtime errors", async () => {
  const provider = new ScriptedProvider(() => [
    { type: "model.started", provider: "test", model: "test-model" },
    { type: "tool_intent.proposed", id: "call-1", toolName: "run_tests", input: "not-json", provider: "test", model: "test-model" },
    { type: "model.finished", stopReason: "tool_use" }
  ]);
  const runtime = new AgentRuntime({ provider, model: "test-model", tools: [runTestsTool()] });

  const outputs = await collect(runtime.send({ text: userText }));

  assert.equal(outputs.at(-1)?.type, "error");
  assert.equal(runtime.getState().status, "failed");
  assert.equal(runtime.getState().lastError?.code, "invalid_tool_intent");
});

test("reduceConversationState rebuilds pending tool state from events", () => {
  const events: RuntimeEvent[] = [
    { type: "user.message", runId: "run-1", text: userText },
    { type: "run.started", runId: "run-1" },
    { type: "model.text.delta", runId: "run-1", text: "我先运行测试。" },
    {
      type: "model.tool.intent",
      runId: "run-1",
      intent: {
        intentId: "intent-1",
        toolName: "run_tests",
        input: { command: "npm test" }
      }
    },
    { type: "run.finished", runId: "run-1", status: "waiting_for_tool", reason: "tool_use" }
  ];

  const state = reduceConversationState(events);

  assert.equal(state.status, "waiting_for_tool");
  assert.equal(state.messages.at(-1)?.content, "我先运行测试。");
  assert.equal(state.pendingToolIntents[0].toolName, "run_tests");
});

test("runAgentLoop wrapper preserves M0 no-execution semantics", async () => {
  const provider = new ScriptedProvider(() => [
    { type: "model.started", provider: "test", model: "test-model" },
    { type: "tool_intent.proposed", id: "call-1", toolName: "run_tests", input: { command: "npm test" }, provider: "test", model: "test-model" },
    { type: "model.finished", stopReason: "tool_use" }
  ]);

  const result = await runAgentLoop({
    model: provider,
    modelName: "test-model",
    messages: [{ role: "user", content: userText }],
    tools: [runTestsTool()]
  });

  assert.equal(result.stopReason, "waiting_for_tool");
  assert.equal(result.pendingToolIntents.length, 1);
  assert.equal(result.pendingToolIntents[0].toolName, "run_tests");
});

function runTestsTool(): ToolDefinition {
  return {
    name: "run_tests",
    description: "Run the project test suite.",
    risk: "execute",
    isReadOnly: true,
    isConcurrencySafe: false
  };
}

async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) {
    values.push(value);
  }
  return values;
}

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
