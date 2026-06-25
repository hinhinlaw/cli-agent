import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityRegistry } from "./registry.js";
import type { ToolContribution, ProviderContribution, RegisteredHook } from "./contracts.js";
import type { ToolExecutor } from "../runtime/contracts.js";

// ─── Helpers ───────────────────────────────────────────────────

function fakeProvider(id: string): ProviderContribution {
  return {
    id,
    displayName: `Display: ${id}`,
    createProvider() {
      return { name: id } as never;
    }
  };
}

function fakeExecutor(name: string): ToolExecutor {
  return {
    name,
    validate: async (input) => ({ ok: true, validatedInput: input }),
    execute: async () => ({
      type: "success" as const,
      output: `output from ${name}`,
      exitCode: 0,
      durationMs: 1
    }),
    toObservation: (result) => ({ content: result.output })
  };
}

function fakeTool(name: string, overrides?: Partial<ToolContribution>): ToolContribution {
  return {
    name,
    description: `Fake tool: ${name}`,
    inputSchema: { type: "object", properties: {} },
    risk: "read",
    isReadOnly: true,
    isConcurrencySafe: true,
    executor: fakeExecutor(name),
    ...overrides
  };
}

function fakeHook(id: string, overrides?: Partial<RegisteredHook>): RegisteredHook {
  return {
    id,
    point: "preToolUse",
    sourcePluginId: "test/plugin",
    sourcePluginSource: "test",
    order: 0,
    blocking: true,
    run: async () => ({ type: "allow" }),
    ...overrides
  };
}

// ─── Provider Registration ──────────────────────────────────────

test("registerProvider adds a provider and auto-enables the plugin", () => {
  const registry = new CapabilityRegistry();

  registry.registerProvider("builtin/openai", "builtin", fakeProvider("openai"));

  const active = registry.getActiveProvider();
  assert.ok(active);
  assert.equal(active.id, "builtin/openai/openai");
  assert.equal(active.sourcePluginId, "builtin/openai");
  assert.equal(active.sourcePluginSource, "builtin");
});

test("registerProvider throws on duplicate registration", () => {
  const registry = new CapabilityRegistry();
  registry.registerProvider("builtin/dupe", "builtin", fakeProvider("same-id"));

  assert.throws(
    () => registry.registerProvider("builtin/dupe", "builtin", fakeProvider("same-id")),
    /already registered/
  );
});

test("getActiveProvider returns undefined when no providers are registered", () => {
  const registry = new CapabilityRegistry();
  assert.equal(registry.getActiveProvider(), undefined);
});

// ─── Tool Registration ─────────────────────────────────────────

test("registerTool adds a tool and makes it visible", () => {
  const registry = new CapabilityRegistry();

  registry.registerTool("builtin/local-tools", "builtin", fakeTool("bash"));

  const definitions = registry.getVisibleToolDefinitions();
  assert.equal(definitions.length, 1);
  assert.equal(definitions[0].name, "builtin/local-tools/bash");
  assert.equal(definitions[0].risk, "read");
});

test("registerTool throws on duplicate tool name", () => {
  const registry = new CapabilityRegistry();
  registry.registerTool("builtin/local-tools", "builtin", fakeTool("bash"));

  assert.throws(
    () => registry.registerTool("builtin/local-tools", "builtin", fakeTool("bash")),
    /already registered/
  );
});

test("getExecutor returns the correct executor for a visible tool", async () => {
  const registry = new CapabilityRegistry();
  registry.registerTool("builtin/local-tools", "builtin", fakeTool("bash"));

  const executor = registry.getExecutor("builtin/local-tools/bash");
  assert.ok(executor);
  assert.equal(executor.name, "bash");
  const result = await executor.execute({ cmd: "ls" });
  assert.equal(result.type, "success");
  assert.ok(result.output.includes("bash"));
});

test("getExecutor returns undefined for unknown tool", () => {
  const registry = new CapabilityRegistry();
  assert.equal(registry.getExecutor("nonexistent/tool"), undefined);
});

test("getExecutor returns undefined when plugin is disabled", () => {
  const registry = new CapabilityRegistry();
  registry.registerTool("builtin/local-tools", "builtin", fakeTool("bash"));
  registry.disablePlugin("builtin/local-tools");

  assert.equal(registry.getExecutor("builtin/local-tools/bash"), undefined);
});

test("getExecutorMap returns all visible tool executors", () => {
  const registry = new CapabilityRegistry();
  registry.registerTool("p1", "builtin", fakeTool("tool-a"));
  registry.registerTool("p1", "builtin", fakeTool("tool-b"));
  registry.registerTool("p2", "builtin", fakeTool("tool-c"));

  const map = registry.getExecutorMap();
  assert.equal(map.size, 3);
  assert.ok(map.has("p1/tool-a"));
  assert.ok(map.has("p1/tool-b"));
  assert.ok(map.has("p2/tool-c"));
});

// ─── Hook Registration ─────────────────────────────────────────

test("registerHook adds a hook and makes it visible at its point", () => {
  const registry = new CapabilityRegistry();

  registry.registerHook(fakeHook("cli-approval"));

  const hooks = registry.getVisibleHooks("preToolUse");
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].id, "cli-approval");
  assert.equal(hooks[0].point, "preToolUse");
});

test("getVisibleHooks returns hooks sorted by order", () => {
  const registry = new CapabilityRegistry();
  registry.registerHook(fakeHook("third", { order: 100 }));
  registry.registerHook(fakeHook("first", { order: 0 }));
  registry.registerHook(fakeHook("second", { order: 50 }));

  const hooks = registry.getVisibleHooks("preToolUse");
  assert.equal(hooks.length, 3);
  assert.equal(hooks[0].id, "first");
  assert.equal(hooks[1].id, "second");
  assert.equal(hooks[2].id, "third");
});

test("getVisibleHooks returns empty array for unknown hook point", () => {
  const registry = new CapabilityRegistry();
  registry.registerHook(fakeHook("test-hook"));
  assert.deepEqual(registry.getVisibleHooks("unknown"), []);
});

// ─── Plugin Enable / Disable ───────────────────────────────────

test("disablePlugin hides tools from that plugin", () => {
  const registry = new CapabilityRegistry();
  registry.registerTool("p-a", "builtin", fakeTool("t1"));
  registry.registerTool("p-b", "builtin", fakeTool("t2"));

  registry.disablePlugin("p-a");

  assert.equal(registry.getVisibleToolDefinitions().length, 1);
  assert.equal(registry.getVisibleToolDefinitions()[0].name, "p-b/t2");
});

test("enablePlugin makes a disabled plugin's tools visible again", () => {
  const registry = new CapabilityRegistry();
  registry.registerTool("p-a", "builtin", fakeTool("t1"));
  registry.disablePlugin("p-a");

  registry.enablePlugin("p-a");

  assert.equal(registry.getVisibleToolDefinitions().length, 1);
});

// ─── Plugin Removal (rollback) ─────────────────────────────────

test("removePlugin removes all providers, tools, hooks and disabled status", () => {
  const registry = new CapabilityRegistry();
  registry.registerProvider("p-x", "builtin", fakeProvider("prov1"));
  registry.registerTool("p-x", "builtin", fakeTool("tool1"));
  registry.registerHook(fakeHook("h1", { sourcePluginId: "p-x", sourcePluginSource: "builtin" }));

  registry.removePlugin("p-x");

  assert.equal(registry.getActiveProvider(), undefined);
  assert.equal(registry.getVisibleToolDefinitions().length, 0);
  assert.equal(registry.getVisibleHooks("preToolUse").length, 0);
});

test("removePlugin does not affect other plugins", () => {
  const registry = new CapabilityRegistry();
  registry.registerTool("p-a", "builtin", fakeTool("ta"));
  registry.registerTool("p-b", "builtin", fakeTool("tb"));

  registry.removePlugin("p-a");

  assert.equal(registry.getVisibleToolDefinitions().length, 1);
  assert.equal(registry.getVisibleToolDefinitions()[0].name, "p-b/tb");
});
