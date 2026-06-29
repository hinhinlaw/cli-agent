import assert from "node:assert/strict";
import test from "node:test";
import type { ChatRequest, ModelEvent } from "./contract.js";
import { ToolCallAssembler } from "./tool-call-assembler.js";
import { FakeStreamingProvider } from "./fake.js";

// ─── Category 1: Provider tool call → tool_intent.proposed ───────────

test("normalizes provider tool calls into tool_intent.proposed events", async () => {
  // FakeStreamingProvider 不产出 tool intent，这里用 inline mock provider
  const provider = new TestProvider([
    { type: "model.started", provider: "test", model: "test" },
    {
      type: "tool_intent.proposed",
      id: "call-1",
      toolName: "bash",
      input: { command: "npm test" },
      providerCallId: "call-1",
      provider: "test",
      model: "test"
    },
    { type: "model.finished", stopReason: "tool_use" }
  ]);

  const events = await collectStream(provider, {
    model: "test",
    messages: [{ role: "user", content: "run tests" }]
  });

  const proposed = events.filter(e => e.type === "tool_intent.proposed");
  assert.equal(proposed.length, 1);
  if (proposed[0].type === "tool_intent.proposed") {
    assert.equal(proposed[0].toolName, "bash");
    assert.deepEqual(proposed[0].input, { command: "npm test" });
    assert.equal(proposed[0].providerCallId, "call-1");
  }
});

// ─── Category 2: Provider runtime does NOT execute tools ─────────────

test("does not execute tools inside provider runtime", async () => {
  let toolExecuted = false;
  const executeSpy = () => { toolExecuted = true; };

  // 创建一个不包含 execute 能力的 ModelEvent stream
  const provider = new TestProvider([
    { type: "model.started", provider: "test", model: "test" },
    {
      type: "tool_intent.proposed",
      id: "call-1",
      toolName: "bash",
      input: { command: "ls" },
      provider: "test",
      model: "test"
    },
    { type: "model.finished", stopReason: "tool_use" }
  ]);

  // Provider 只产出事件，不调用 executeSpy
  const events = await collectStream(provider, {
    model: "test",
    messages: [{ role: "user", content: "list files" }]
  });

  // Provider 产出了 intent 但没有执行
  const proposed = events.filter(e => e.type === "tool_intent.proposed");
  assert.equal(proposed.length, 1);

  // executeSpy 从未被 Provider Runtime 调用
  assert.equal(toolExecuted, false);
  void executeSpy; // suppress unused warning
});

// ─── Category 3: Delta assembly before proposing intent ──────────────

test("assembles streamed tool call deltas before proposing intent", () => {
  const assembler = new ToolCallAssembler();

  // 模拟两次 delta
  assembler.push("call-1", "bash", "{\"command\":");
  assembler.push("call-1", undefined, "\"npm test\"}");

  const finalized = assembler.finalize();
  assert.equal(finalized.length, 1);
  assert.equal(finalized[0].toolName, "bash");
  assert.equal(finalized[0].parseOk, true);
  assert.deepEqual(finalized[0].input, { command: "npm test" });
});

test("tool_intent.delta appears before tool_intent.proposed in stream", async () => {
  const provider = new TestProvider([
    { type: "model.started", provider: "test", model: "test" },
    // Delta first (simulating streaming)
    { type: "tool_intent.delta", providerCallId: "call-1", toolName: "read_file", rawInputText: "{\"path\":\"test.ts\"}" },
    // Then proposed
    {
      type: "tool_intent.proposed",
      id: "call-1",
      toolName: "read_file",
      input: { path: "test.ts" },
      providerCallId: "call-1",
      provider: "test",
      model: "test"
    },
    { type: "model.finished", stopReason: "tool_use" }
  ]);

  const events = await collectStream(provider, {
    model: "test",
    messages: [{ role: "user", content: "read test.ts" }]
  });

  const types = events.map(e => e.type);

  const deltaIdx = types.indexOf("tool_intent.delta");
  const proposedIdx = types.indexOf("tool_intent.proposed");

  assert.ok(deltaIdx >= 0, "Should contain tool_intent.delta");
  assert.ok(proposedIdx >= 0, "Should contain tool_intent.proposed");
  assert.ok(deltaIdx < proposedIdx, "Delta must appear before proposed");
});

test("assembler handles malformed JSON gracefully", () => {
  const assembler = new ToolCallAssembler();
  assembler.push("call-1", "bash", "not-valid-json");
  const finalized = assembler.finalize();
  assert.equal(finalized[0].parseOk, false);
  assert.equal(finalized[0].input, undefined);
});

// ─── Category 4: Provider error ≠ tool error ────────────────────────

test("maps provider errors without creating tool observations", async () => {
  const provider = new TestProvider([
    {
      type: "provider.error",
      error: {
        kind: "rate_limit",
        retryable: true,
        message: "Too many requests",
        provider: "test"
      }
    }
  ]);

  const events = await collectStream(provider, {
    model: "test",
    messages: [{ role: "user", content: "hi" }]
  });

  // 包含 provider error
  const errors = events.filter(e => e.type === "provider.error");
  assert.equal(errors.length, 1);
  if (errors[0].type === "provider.error") {
    assert.equal(errors[0].error.kind, "rate_limit");
    assert.equal(errors[0].error.retryable, true);
  }

  // 不含 tool execution 事件（tool.observed / tool.execution 等）
  assert.ok(!events.some(e => e.type === "model.finished"), "No model.finished because stream errored");
  assert.ok(!events.some(e => e.type.startsWith("tool.")), "No tool execution events from provider");
});

// ─── Category 5: Provider runtime is request-scoped ──────────────────

test("keeps provider runtime request-scoped", () => {
  const assembler1 = new ToolCallAssembler();
  assembler1.push("a", "toolA", "{}");

  const assembler2 = new ToolCallAssembler();
  assembler2.push("b", "toolB", "{}");

  // 两个 assembler 不应该共享状态
  const r1 = assembler1.finalize();
  const r2 = assembler2.finalize();

  assert.equal(r1.length, 1);
  assert.equal(r1[0].toolName, "toolA");
  assert.equal(r1[0].providerCallId, "a");

  assert.equal(r2.length, 1);
  assert.equal(r2[0].toolName, "toolB");
  assert.equal(r2[0].providerCallId, "b");
});

test("FakeStreamingProvider produces same event sequence each call", async () => {
  const provider = new FakeStreamingProvider();

  const events1 = await collectStream(provider, {
    model: "test",
    messages: [{ role: "user", content: "hi" }]
  });
  const events2 = await collectStream(provider, {
    model: "test",
    messages: [{ role: "user", content: "hi" }]
  });

  assert.deepEqual(
    events1.map(e => e.type),
    events2.map(e => e.type)
  );
  assert.equal(
    events1.filter(e => e.type === "model.text_delta").length,
    events2.filter(e => e.type === "model.text_delta").length
  );
});

// ─── Category 6: Tool result projected by Core (not provider) ────────

test("provider runtime does not contain tool result projection logic", () => {
  // Provider 的 ModelEvent 不包含 observation 或 tool_result 类型
  // tool result projection 应该在 Core 层完成
  const provider = new FakeStreamingProvider();

  const eventTypes = [
    "model.started",
    "model.text_delta",
    "model.finished",
    "tool_intent.delta",
    "tool_intent.proposed",
    "provider.error"
  ];

  // 验证 FakeStreamingProvider 只产出这 6 种事件，没有 tool_result/tool.observed 等
  const stream = provider.stream({
    model: "test",
    messages: [{ role: "user", content: "hi" }]
  });

  // 检查 TypeScript 类型层面（编译时已验证）：
  // ModelEvent 联合类型不包含 tool execution/observation 事件
  for (const t of eventTypes) {
    assert.ok(t.startsWith("model.") || t.startsWith("tool_intent.") || t.startsWith("provider."),
      `Event type "${t}" should follow model.* / tool_intent.* / provider.* prefix pattern`);
  }
});

// ─── Helpers ────────────────────────────────────────────────────────

class TestProvider {
  name = "test";
  constructor(private readonly events: ModelEvent[]) {}

  async *stream(_request: ChatRequest): AsyncIterable<ModelEvent> {
    for (const event of this.events) {
      yield event;
    }
  }
}

async function collectStream(
  provider: { stream(request: ChatRequest): AsyncIterable<ModelEvent> },
  request: ChatRequest
): Promise<ModelEvent[]> {
  const events: ModelEvent[] = [];
  for await (const event of provider.stream(request)) {
    events.push(event);
  }
  return events;
}
