import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityRegistry } from "../core/registry.js";
import type { RegisteredHook, HookDecision, HookInput } from "../core/contracts.js";
import { HookKernel } from "./hook-kernel.js";

function allowHook(id: string, overrides?: Partial<RegisteredHook>): RegisteredHook {
  return {
    id,
    point: "preToolUse",
    sourcePluginId: "test/plugin",
    sourcePluginSource: "test",
    order: 0,
    blocking: true,
    run: async () => ({ type: "allow", reason: `allowed by ${id}` }),
    ...overrides
  };
}

function denyHook(id: string, reason: string): RegisteredHook {
  return {
    id,
    point: "preToolUse",
    sourcePluginId: "test/plugin",
    sourcePluginSource: "test",
    order: 0,
    blocking: true,
    run: async () => ({ type: "deny", reason })
  };
}

function askHook(id: string, question: string): RegisteredHook {
  return {
    id,
    point: "preToolUse",
    sourcePluginId: "test/plugin",
    sourcePluginSource: "test",
    order: 0,
    blocking: true,
    run: async () => ({ type: "ask", question, risk: "medium" })
  };
}

const fakeIntent: HookInput["intent"] = {
  intentId: "i-1",
  toolName: "test/tool",
  input: { key: "value" }
};

// ─── Basic Gate ────────────────────────────────────────────────

test("runPreToolUse returns allow when there are no hooks registered", async () => {
  const registry = new CapabilityRegistry();
  const kernel = new HookKernel(registry);

  const decision = await kernel.runPreToolUse(fakeIntent);
  assert.equal(decision.type, "allow");
});

test("runPreToolUse returns allow when all hooks allow", async () => {
  const registry = new CapabilityRegistry();
  registry.registerHook(allowHook("h1"));
  registry.registerHook(allowHook("h2"));
  const kernel = new HookKernel(registry);

  const decision = await kernel.runPreToolUse(fakeIntent);
  assert.equal(decision.type, "allow");
});

test("runPreToolUse returns deny when a blocking hook denies", async () => {
  const registry = new CapabilityRegistry();
  registry.registerHook(allowHook("h1"));
  registry.registerHook(denyHook("h2", "blocked by policy"));
  registry.registerHook(allowHook("h3")); // should never run
  const kernel = new HookKernel(registry);

  const decision = await kernel.runPreToolUse(fakeIntent);
  assert.equal(decision.type, "deny");
  if (decision.type === "deny") {
    assert.ok(decision.reason.includes("blocked by policy"));
  }
});

test("runPreToolUse returns ask when a hook asks for user input", async () => {
  const registry = new CapabilityRegistry();
  registry.registerHook(askHook("h1", "Are you sure?"));
  const kernel = new HookKernel(registry);

  const decision = await kernel.runPreToolUse(fakeIntent);
  assert.equal(decision.type, "ask");
  if (decision.type === "ask") {
    assert.equal(decision.question, "Are you sure?");
  }
});

test("runPreToolUse runs hooks in order and stops at first deny", async () => {
  const runOrder: string[] = [];
  const registry = new CapabilityRegistry();

  registry.registerHook({
    id: "first",
    point: "preToolUse",
    sourcePluginId: "test",
    sourcePluginSource: "test",
    order: 0,
    blocking: true,
    run: async () => {
      runOrder.push("first");
      return { type: "allow" };
    }
  });
  registry.registerHook({
    id: "second",
    point: "preToolUse",
    sourcePluginId: "test",
    sourcePluginSource: "test",
    order: 50,
    blocking: true,
    run: async () => {
      runOrder.push("second");
      return { type: "deny", reason: "stop here" };
    }
  });
  registry.registerHook({
    id: "third",
    point: "preToolUse",
    sourcePluginId: "test",
    sourcePluginSource: "test",
    order: 100,
    blocking: true,
    run: async () => {
      runOrder.push("third");
      return { type: "allow" };
    }
  });

  const kernel = new HookKernel(registry);
  await kernel.runPreToolUse(fakeIntent);

  assert.deepEqual(runOrder, ["first", "second"]);
  // third should never run because second returned deny
});

// ─── Failure Semantics ─────────────────────────────────────────

test("blocking hook failure → fail closed (deny)", async () => {
  const registry = new CapabilityRegistry();
  registry.registerHook({
    id: "crashy",
    point: "preToolUse",
    sourcePluginId: "test",
    sourcePluginSource: "test",
    order: 0,
    blocking: true,
    run: async () => {
      throw new Error("Unexpected crash in hook!");
    }
  });
  const kernel = new HookKernel(registry);

  const decision = await kernel.runPreToolUse(fakeIntent);
  assert.equal(decision.type, "deny");
  if (decision.type === "deny") {
    assert.ok(decision.reason.includes("Unexpected crash"));
    assert.ok(decision.reason.includes("crashy"));
  }
});

test("observer (non-blocking) hook failure → fail open (skip)", async () => {
  const runOrder: string[] = [];
  const registry = new CapabilityRegistry();
  registry.registerHook({
    id: "failing-observer",
    point: "preToolUse",
    sourcePluginId: "test",
    sourcePluginSource: "test",
    order: 0,
    blocking: false, // 观察型
    run: async () => {
      runOrder.push("failing-observer");
      throw new Error("Observer crash");
    }
  });
  registry.registerHook({
    id: "next-hook",
    point: "preToolUse",
    sourcePluginId: "test",
    sourcePluginSource: "test",
    order: 50,
    blocking: true,
    run: async () => {
      runOrder.push("next-hook");
      return { type: "allow" };
    }
  });
  const kernel = new HookKernel(registry);

  const decision = await kernel.runPreToolUse(fakeIntent);
  assert.equal(decision.type, "allow");
  assert.deepEqual(runOrder, ["failing-observer", "next-hook"]);
});

// ─── Timeout ───────────────────────────────────────────────────

test("hook timeout with defaultTimeoutMs → fail closed for blocking hooks", async () => {
  const registry = new CapabilityRegistry();
  registry.registerHook({
    id: "slow",
    point: "preToolUse",
    sourcePluginId: "test",
    sourcePluginSource: "test",
    order: 0,
    blocking: true,
    run: async () => {
      return new Promise(() => {
        // never resolves — simulates hang
      });
    }
  });
  const kernel = new HookKernel(registry, { defaultTimeoutMs: 50 });

  const decision = await kernel.runPreToolUse(fakeIntent);
  assert.equal(decision.type, "deny");
  if (decision.type === "deny") {
    assert.ok(decision.reason.includes("timed out"));
  }
});

test("hook-specific timeoutMs overrides default", async () => {
  const registry = new CapabilityRegistry();
  registry.registerHook({
    id: "very-slow",
    point: "preToolUse",
    sourcePluginId: "test",
    sourcePluginSource: "test",
    order: 0,
    blocking: true,
    timeoutMs: 50, // 50ms timeout
    run: async () => new Promise(() => {}) // never resolves
  });
  const kernel = new HookKernel(registry, { defaultTimeoutMs: 99999 }); // very long default

  const start = Date.now();
  const decision = await kernel.runPreToolUse(fakeIntent);
  const elapsed = Date.now() - start;

  assert.equal(decision.type, "deny");
  assert.ok(elapsed < 500); // should be fast (50ms timeout)
});
