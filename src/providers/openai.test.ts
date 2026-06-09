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
