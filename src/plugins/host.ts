import type {
  PluginContribution,
  PluginEvent,
  PluginModule,
  RegisteredHook
} from "../core/contracts.js";
import type { PluginSource } from "../core/contracts.js";
import type { CapabilityRegistry } from "../core/registry.js";
import { createSetupContext } from "./setup-context.js";
import { validateManifest } from "./manifest.js";
import type { HookKernel } from "./hook-kernel.js";

export type PluginEventSink = (event: PluginEvent) => void;

/**
 * PluginHost 是外部能力进入 core 的受控入口。
 *
 * 原则：
 * - 插件只能提交 contribution，不能直接拿 core
 * - manifest 先校验，再 setup
 * - setup 失败 → plugin.failed，不注册任何能力
 * - 注册中途失败 → 回滚已注册的能力
 * - 所有阶段产生的事件写入 EventBus
 */
export class PluginHost {
  private state = new Map<string, "loaded" | "ready" | "failed">();

  constructor(
    private registry: CapabilityRegistry,
    private hookKernel: HookKernel,
    private onEvent: PluginEventSink
  ) {}

  /**
   * 加载一个插件：manifest 校验 → setup → 注册 contribution。
   * 过程中产生的事件通过 onEvent 回调写入外部 EventBus。
   */
  async load(pluginModule: PluginModule, source: PluginSource): Promise<void> {
    // 1. 校验 manifest
    const validation = validateManifest(pluginModule.manifest);
    if (!validation.ok) {
      const fallbackId = pluginModule.manifest.id || "unknown";
      const errorMsg = `Manifest validation failed for "${fallbackId}": ${validation.errors.join("; ")}`;
      this.onEvent({
        type: "plugin.failed",
        pluginId: fallbackId,
        source,
        error: errorMsg
      });
      throw new Error(errorMsg);
    }

    const pluginId = pluginModule.manifest.id!;

    // 2. 记录 plugin.loaded
    this.state.set(pluginId, "loaded");
    this.onEvent({ type: "plugin.loaded", pluginId, source });

    // 3. setup — 受限初始化
    const ctx = createSetupContext(pluginModule.manifest, source);
    let contribution: PluginContribution;
    try {
      contribution = await pluginModule.setup(ctx);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.state.set(pluginId, "failed");
      this.onEvent({
        type: "plugin.failed",
        pluginId,
        source,
        error: `Plugin setup failed: ${message}`
      });
      // setup 失败 → 不注册任何能力，但不抛异常（不拖垮 host）
      return;
    }

    // 4. 注册 contribution（带错误处理和回滚）
    try {
      this.registerContributions(pluginId, source, contribution);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // 注册中途失败 → 回滚已注册的能力
      this.registry.removePlugin(pluginId);
      this.state.set(pluginId, "failed");
      this.onEvent({
        type: "plugin.failed",
        pluginId,
        source,
        error: `Registration failed (rolled back): ${message}`
      });
      return;
    }

    // 5. 成功 → plugin.ready
    this.state.set(pluginId, "ready");
    this.onEvent({ type: "plugin.ready", pluginId, source });
  }

  getState(pluginId: string): "loaded" | "ready" | "failed" | undefined {
    return this.state.get(pluginId);
  }

  // ─── Private ──────────────────────────────────────────────────

  private registerContributions(
    pluginId: string,
    source: PluginSource,
    contribution: PluginContribution
  ): void {
    // Provider（按注册顺序，rollback 时反向移除）
    const registered: { kind: "provider" | "tool" | "hook"; id: string }[] = [];

    try {
      for (const provider of contribution.providers ?? []) {
        this.registry.registerProvider(pluginId, source, provider);
        registered.push({ kind: "provider", id: provider.id });
      }

      for (const tool of contribution.tools ?? []) {
        this.registry.registerTool(pluginId, source, tool);
        registered.push({ kind: "tool", id: tool.name });
      }

      for (const hook of contribution.hooks ?? []) {
        const registeredHook: RegisteredHook = {
          id: `${pluginId}/${hook.id}`,
          point: hook.point,
          sourcePluginId: pluginId,
          sourcePluginSource: source,
          order: hook.order ?? 0,
          blocking: hook.blocking,
          timeoutMs: hook.timeoutMs,
          run: hook.run
        };
        this.registry.registerHook(registeredHook);
        registered.push({ kind: "hook", id: hook.id });
      }
    } catch (error) {
      // 注册中途失败 → 已在 load() 中处理回滚
      throw error;
    }
  }
}
