import assert from "node:assert/strict";
import test from "node:test";
import { providerErrorFromHttp, userFacingProviderMessage } from "./errors.js";

test("providerErrorFromHttp maps auth failures into structured errors", () => {
  const error = providerErrorFromHttp({
    provider: "openai",
    statusCode: 401,
    message: "Incorrect API key provided.",
    requestId: "req_123"
  });

  assert.equal(error.kind, "auth");
  assert.equal(error.retryable, false);
  assert.equal(error.provider, "openai");
  assert.equal(error.statusCode, 401);
  assert.equal(error.requestId, "req_123");
  assert.match(userFacingProviderMessage(error), /API Key/);
});

test("providerErrorFromHttp maps rate limits as retryable", () => {
  const error = providerErrorFromHttp({
    provider: "openai",
    statusCode: 429,
    message: "Rate limit reached."
  });

  assert.equal(error.kind, "rate_limit");
  assert.equal(error.retryable, true);
});

test("providerErrorFromHttp maps quota failures as non-retryable", () => {
  const error = providerErrorFromHttp({
    provider: "openai",
    statusCode: 429,
    message: "You exceeded your current quota, please check your billing details."
  });

  assert.equal(error.kind, "quota");
  assert.equal(error.retryable, false);
});
