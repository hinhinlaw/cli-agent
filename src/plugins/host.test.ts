import assert from "node:assert/strict";
import test from "node:test";
import { CapabilityRegistry } from "../core/registry.js";
import type {
  PluginContribution,
  PluginEvent,
  PluginManifest,
  PluginModule,
  PluginSetupContext
} from "../core/contracts.js";
import type { ToolExecutor } from "../runtime/contracts.js";
import { HookKernel } from "./hook-kernel.js";
import { PluginHost } from "./host.js";

// ─── Helpers ───────────────────────────────────────────────────

function noopHookKernel(): HookKernel {
  return new HookKernel(new CapabilityRegistry());
}

function makePlugin(
  overrides: Partial<PluginManifest> = {},
  setupResult: PluginContribution = {}
): PluginModule {
  return {
    manifest: {
      id: "test/minimal",
      name: "Minimal Plugin",
      version: "1.0.0",
      ...overrides
    },
    setup: async (_ctx: PluginSetupContext): Promise<PluginContribution> => setupResult
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

function pluginWithTools(): PluginModule {
  const exec = fakeExecutor("bash");
  return {
    manifest: {
      id: "builtin/local-tools",
      name: "Local Tools",
      version: "0.1.0"
    },
    setup: async (_ctx: PluginSetupContext) => ({
      tools: [
        {
          name: "bash",
          description: "Execute a shell command.",
          inputSchema: { type: "object", properties: { cmd: { type: "string" } } },
          risk: "execute",
          isReadOnly: false,
          isConcurrencySafe: false,
          executor: exec
        }
      ]
    })
  };
}

function pluginWithProvider(): PluginModule {
  return {
    manifest: {
      id: "builtin/openai",
      name: "OpenAI Provider",
      version: "0.1.0"
    },
    setup: async (_ctx: PluginSetupContext) => ({
      providers: [
        {
          id: "openai",
          displayName: "OpenAI",
          createProvider(config) {
            return {
              name: "openai",
              chat: async () => ({ text: "" }),
              stream: async function* () {}
            } as never;
          }
        }
      ]
    })
  };
}

function pluginWithHook(): PluginModule {
  return {
    manifest: {
      id: "builtin/policy",
      name: "Policy Hook",
      version: "0.1.0",
      contributes: { hooks: ["preToolUse"] }
    },
    setup: async (_ctx: PluginSetupContext) => ({
      hooks: [
        {
          point: "preToolUse",
          id: "cli-approval",
          order: 100,
          blocking: true,
          run: async () => ({ type: "allow", reason: "allowed" })
        }
      ]
    })
  };
}

// ─── Load → Plugin State ───────────────────────────────────────

test("load a valid plugin: loaded → ready with correct events", async () => {
  const registry = new CapabilityRegistry();
  const events: PluginEvent[] = [];
  const host = new PluginHost(registry, noopHookKernel(), (e) => events.push(e));

  await host.load(makePlugin(), "builtin");

  assert.equal(host.getState("test/minimal"), "ready");
  assert.deepEqual(
    events.map(e => e.type),
    ["plugin.loaded", "plugin.ready"]
  );
});

test("load a plugin with invalid manifest → plugin.failed, pluginId=unknown", async () => {
  const registry = new CapabilityRegistry();
  const events: PluginEvent[] = [];
  const host = new PluginHost(registry, noopHookKernel(), (e) => events.push(e));

  const badPlugin = makePlugin({ id: "", name: "" }); // missing id

  await assert.rejects(
    () => host.load(badPlugin, "test"),
    /Manifest validation failed/
  );
  assert.equal(host.getState("unknown"), undefined);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "plugin.failed");
  if (events[0].type === "plugin.failed") {
    assert.ok(events[0].error.includes("Manifest validation failed"));
    assert.equal(events[0].pluginId, "unknown");
  }
});

test("load plugin with setup failure → plugin.failed but no throw", async () => {
  const registry = new CapabilityRegistry();
  const events: PluginEvent[] = [];
  const host = new PluginHost(registry, noopHookKernel(), (e) => events.push(e));

  const crashyPlugin: PluginModule = {
    manifest: {
      id: "test/crashy",
      name: "Crashy",
      version: "1.0.0"
    },
    setup: async () => {
      throw new Error("Setup exploded!");
    }
  };

  // setup 失败不会抛异常（不拖垮 host）
  await host.load(crashyPlugin, "test");

  assert.equal(host.getState("test/crashy"), "failed");
  assert.deepEqual(
    events.map(e => e.type),
    ["plugin.loaded", "plugin.failed"]
  );
  const failedEvent = events.find(e => e.type === "plugin.failed");
  if (failedEvent && failedEvent.type === "plugin.failed") {
    assert.ok(failedEvent.error.includes("Setup exploded"));
  }
});

// ─── Contribution Registration ─────────────────────────────────

test("load plugin with tools → tools are visible in registry", async () => {
  const registry = new CapabilityRegistry();
  const events: PluginEvent[] = [];
  const host = new PluginHost(registry, noopHookKernel(), (e) => events.push(e));

  await host.load(pluginWithTools(), "builtin");

  const tools = registry.getVisibleToolDefinitions();
  assert.equal(tools.length, 1);
  assert.equal(tools[0].name, "builtin/local-tools/bash");
  assert.equal(tools[0].risk, "execute");

  const executor = registry.getExecutor("builtin/local-tools/bash");
  assert.ok(executor);
  assert.equal(executor.name, "bash");
  const result = await executor.execute({ cmd: "ls" });
  assert.equal(result.type, "success");
  assert.ok(result.output.includes("bash"));
});

test("load plugin with provider → active provider is available", async () => {
  const registry = new CapabilityRegistry();
  const host = new PluginHost(registry, noopHookKernel(), () => {});

  await host.load(pluginWithProvider(), "builtin");

  const active = registry.getActiveProvider();
  assert.ok(active);
  assert.equal(active.id, "builtin/openai/openai");
  assert.equal(active.sourcePluginId, "builtin/openai");
});

test("load plugin with hooks → hooks are visible", async () => {
  const registry = new CapabilityRegistry();
  const host = new PluginHost(registry, noopHookKernel(), () => {});

  await host.load(pluginWithHook(), "builtin");

  const hooks = registry.getVisibleHooks("preToolUse");
  assert.equal(hooks.length, 1);
  assert.equal(hooks[0].id, "builtin/policy/cli-approval");
  assert.equal(hooks[0].sourcePluginId, "builtin/policy");
  assert.equal(hooks[0].order, 100);
  assert.equal(hooks[0].blocking, true);
});

// ─── Registration Rollback ─────────────────────────────────────

test("registration failure mid-way → rollback, plugin.failed", async () => {
  const registry = new CapabilityRegistry();
  const events: PluginEvent[] = [];
  const host = new PluginHost(registry, noopHookKernel(), (e) => events.push(e));

  const exec = fakeExecutor("sometool");

  // 第二个 tool 会在 registerTool 时因为和第一个重名而失败
  const dupePlugin: PluginModule = {
    manifest: {
      id: "test/dupe",
      name: "Dupe Tools",
      version: "1.0.0"
    },
    setup: async (_ctx) => ({
      tools: [
        {
          name: "sometool",
          description: "First registration.",
          inputSchema: {},
          risk: "read",
          isReadOnly: true,
          isConcurrencySafe: true,
          executor: exec
        },
        {
          name: "sometool", // DUPLICATE name!
          description: "Will fail.",
          inputSchema: {},
          risk: "read",
          isReadOnly: true,
          isConcurrencySafe: true,
          executor: exec
        }
      ]
    })
  };

  await host.load(dupePlugin, "test");

  assert.equal(host.getState("test/dupe"), "failed");
  // rollback should clear all registrations
  assert.equal(registry.getVisibleToolDefinitions().length, 0);
  assert.equal(registry.getExecutor("test/dupe/sometool"), undefined);
});

// ─── Multiple Plugins ──────────────────────────────────────────

test("loading multiple plugins aggregates their contributions", async () => {
  const registry = new CapabilityRegistry();
  const host = new PluginHost(registry, noopHookKernel(), () => {});

  await host.load(pluginWithTools(), "builtin");
  await host.load(pluginWithProvider(), "builtin");

  assert.equal(registry.getVisibleToolDefinitions().length, 1);
  assert.ok(registry.getActiveProvider());

  assert.equal(host.getState("builtin/local-tools"), "ready");
  assert.equal(host.getState("builtin/openai"), "ready");
});

// ─── Setup Context ─────────────────────────────────────────────

test("plugin setup receives proper context with logger, config, workspace", async () => {
  const registry = new CapabilityRegistry();
  const host = new PluginHost(registry, noopHookKernel(), () => {});

  let capturedCtx: PluginSetupContext | undefined;
  const inspectingPlugin: PluginModule = {
    manifest: {
      id: "test/inspector",
      name: "Inspector",
      version: "1.0.0"
    },
    setup: async (ctx) => {
      capturedCtx = ctx;
      return {};
    }
  };

  await host.load(inspectingPlugin, "test");

  assert.ok(capturedCtx);
  assert.ok(capturedCtx!.logger);
  assert.equal(typeof capturedCtx!.logger.info, "function");
  assert.ok(capturedCtx!.config);
  assert.equal(typeof capturedCtx!.config.get, "function");
  assert.equal(typeof capturedCtx!.config.require, "function");
  assert.ok(capturedCtx!.workspace);
  assert.equal(typeof capturedCtx!.workspace.cwd, "string");
});
