import assert from "node:assert/strict";
import test from "node:test";
import { ensureState } from "./lifecycle.js";

test("ensureState allows loaded → ready", () => {
  assert.doesNotThrow(() => ensureState("loaded", "ready"));
});

test("ensureState allows loaded → failed", () => {
  assert.doesNotThrow(() => ensureState("loaded", "failed"));
});

test("ensureState allows ready → failed", () => {
  assert.doesNotThrow(() => ensureState("ready", "failed"));
});

test("ensureState is idempotent (same state)", () => {
  assert.doesNotThrow(() => ensureState("loaded", "loaded"));
  assert.doesNotThrow(() => ensureState("ready", "ready"));
  assert.doesNotThrow(() => ensureState("failed", "failed"));
});

test("ensureState throws for invalid transition: ready → loaded", () => {
  assert.throws(
    () => ensureState("ready", "loaded"),
    /Invalid plugin state transition/
  );
});

test("ensureState throws for invalid transition: failed → loaded", () => {
  assert.throws(
    () => ensureState("failed", "loaded"),
    /Invalid plugin state transition/
  );
});

test("ensureState throws for invalid transition: failed → ready", () => {
  assert.throws(
    () => ensureState("failed", "ready"),
    /Invalid plugin state transition/
  );
});
