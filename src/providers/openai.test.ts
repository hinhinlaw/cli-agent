import assert from "node:assert/strict";
import test from "node:test";
import { OpenAIProvider } from "./openai.js";

test("OpenAIProvider maps HTTP auth errors into ProviderError events", async () => {
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async () =>
    new Response(JSON.stringify({ error: { message: "Incorrect API key provided." } }), {
      status: 401,
      headers: {
        "x-request-id": "req_test"
      }
    });

  try {
    const provider = new OpenAIProvider({ apiKey: "test-key" });
    const events = [];

    for await (const event of provider.stream({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }]
    })) {
      events.push(event);
    }

    assert.equal(events.length, 1);
    assert.equal(events[0]?.type, "error");
    if (events[0]?.type !== "error") {
      throw new Error("Expected error event.");
    }
    assert.equal(events[0].error.kind, "auth");
    assert.equal(events[0].error.retryable, false);
    assert.equal(events[0].error.provider, "openai");
    assert.equal(events[0].error.statusCode, 401);
    assert.equal(events[0].error.requestId, "req_test");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("OpenAIProvider aggregates streamed tool call fragments into one tool_intent", async () => {
  const originalFetch = globalThis.fetch;
  let capturedBody = "";

  globalThis.fetch = async (_input, init) => {
    capturedBody = String(init?.body ?? "");
    return new Response(
      sseStream([
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    id: "call_1",
                    function: { name: "run_tests", arguments: "{\"command\":" }
                  }
                ]
              }
            }
          ]
        },
        {
          choices: [
            {
              delta: {
                tool_calls: [
                  {
                    index: 0,
                    function: { arguments: "\"npm test\"}" }
                  }
                ]
              },
              finish_reason: "tool_calls"
            }
          ],
          usage: { prompt_tokens: 1, completion_tokens: 2, total_tokens: 3 }
        },
        "[DONE]"
      ]),
      {
        status: 200,
        headers: { "content-type": "text/event-stream" }
      }
    );
  };

  try {
    const provider = new OpenAIProvider({ apiKey: "test-key" });
    const events = [];

    for await (const event of provider.stream({
      model: "gpt-test",
      messages: [{ role: "user", content: "hello" }],
      tools: [{ name: "run_tests", description: "Run tests", inputSchema: { type: "object" } }]
    })) {
      events.push(event);
    }

    const requestBody = JSON.parse(capturedBody) as { tools?: Array<{ function?: { name?: string } }> };
    assert.equal(requestBody.tools?.[0]?.function?.name, "run_tests");
    assert.deepEqual(
      events.filter((event) => event.type === "tool_intent"),
      [{ type: "tool_intent", id: "call_1", name: "run_tests", argumentsText: "{\"command\":\"npm test\"}" }]
    );
    assert.equal(events.at(-1)?.type, "message_stop");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function sseStream(events: Array<Record<string, unknown> | "[DONE]">): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream({
    start(controller) {
      for (const event of events) {
        const payload = event === "[DONE]" ? "[DONE]" : JSON.stringify(event);
        controller.enqueue(encoder.encode(`data: ${payload}\n\n`));
      }
      controller.close();
    }
  });
}
