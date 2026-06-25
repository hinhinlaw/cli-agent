import type { ToolDefinition } from "../runtime/contracts.js";
import type {
  PluginSource,
  ProviderContribution,
  RegisteredHook,
  RegisteredProvider,
  RegisteredTool,
  ToolContribution
} from "./contracts.js";

/**
 * CapabilityRegistry 把插件贡献的外部能力归一化成 core 能理解的内部对象。
 *
 * 三个"不等于"：
 * - registered ≠ visible（禁用插件的工具不可见）
 * - visible ≠ executable（还要过 hook gate）
 * - executable ≠ 可绕过审计（必须进 event log）
 */
export class CapabilityRegistry {
  private providers = new Map<string, RegisteredProvider>();
  private tools = new Map<string, RegisteredTool>();
  private hooks = new Map<string, RegisteredHook>();
  private enabledPlugins = new Set<string>();

  // ─── Provider ────────────────────────────────────────────────

  registerProvider(
    pluginId: string,
    source: PluginSource,
    contribution: ProviderContribution
  ): void {
    const fullId = `${pluginId}/${contribution.id}`;
    if (this.providers.has(fullId)) {
      throw new Error(`Provider "${fullId}" is already registered.`);
    }
    this.providers.set(fullId, {
      id: fullId,
      displayName: contribution.displayName,
      sourcePluginId: pluginId,
      sourcePluginSource: source,
      provider: contribution.createProvider({
        apiKey: process.env.OPENAI_API_KEY ?? "",
        baseUrl: process.env.LLM_BASE_URL,
        model: process.env.LLM_MODEL
      })
    });
    this.enabledPlugins.add(pluginId);
  }

  /** 返回当前活跃的 provider（简单策略：返回第一个 ready 的） */
  getActiveProvider(): RegisteredProvider | undefined {
    for (const [fullId, entry] of this.providers) {
      if (this.enabledPlugins.has(entry.sourcePluginId)) {
        return entry;
      }
    }
    return undefined;
  }

  // ─── Tool ─────────────────────────────────────────────────────

  registerTool(
    pluginId: string,
    source: PluginSource,
    contribution: ToolContribution
  ): void {
    const fullName = `${pluginId}/${contribution.name}`;
    if (this.tools.has(fullName)) {
      throw new Error(`Tool "${fullName}" is already registered.`);
    }
    this.tools.set(fullName, {
      name: fullName,
      description: contribution.description,
      inputSchema: contribution.inputSchema,
      risk: contribution.risk,
      isReadOnly: contribution.isReadOnly,
      isConcurrencySafe: contribution.isConcurrencySafe,
      sourcePluginId: pluginId,
      sourcePluginSource: source,
      executor: contribution.executor
    });
    this.enabledPlugins.add(pluginId);
  }

  /** 返回当前可见的工具定义（用于发给 LLM 的 tools 字段） */
  getVisibleToolDefinitions(): ToolDefinition[] {
    const visible: ToolDefinition[] = [];
    for (const [, entry] of this.tools) {
      if (this.enabledPlugins.has(entry.sourcePluginId)) {
        visible.push({
          name: entry.name,
          description: entry.description,
          inputSchema: entry.inputSchema,
          risk: entry.risk,
          isReadOnly: entry.isReadOnly,
          isConcurrencySafe: entry.isConcurrencySafe
        });
      }
    }
    return visible;
  }

  /** 返回 executor map（用于 5 阶段管线） */
  getExecutorMap(): Map<string, import("../runtime/contracts.js").ToolExecutor> {
    const map = new Map<string, import("../runtime/contracts.js").ToolExecutor>();
    for (const [name, entry] of this.tools) {
      if (this.enabledPlugins.has(entry.sourcePluginId)) {
        map.set(name, entry.executor);
      }
    }
    return map;
  }

  /** 查询某个 tool 的 executor（model 提的 intent.toolName 就是 full name） */
  getExecutor(toolName: string): import("../runtime/contracts.js").ToolExecutor | undefined {
    const entry = this.tools.get(toolName);
    if (!entry || !this.enabledPlugins.has(entry.sourcePluginId)) {
      return undefined;
    }
    return entry.executor;
  }

  // ─── Hook ─────────────────────────────────────────────────────

  registerHook(hook: RegisteredHook): void {
    const key = `${hook.point}:${hook.id}`;
    if (this.hooks.has(key)) {
      throw new Error(`Hook "${key}" is already registered.`);
    }
    this.hooks.set(key, hook);
    this.enabledPlugins.add(hook.sourcePluginId);
  }

  /** 返回指定 hook point 的可见 hooks（按 order 排序） */
  getVisibleHooks(point: string): RegisteredHook[] {
    const result: RegisteredHook[] = [];
    for (const [, hook] of this.hooks) {
      if (hook.point === point && this.enabledPlugins.has(hook.sourcePluginId)) {
        result.push(hook);
      }
    }
    result.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    return result;
  }

  // ─── Plugin 启用/禁用/移除 ────────────────────────────────────

  enablePlugin(pluginId: string): void {
    this.enabledPlugins.add(pluginId);
  }

  disablePlugin(pluginId: string): void {
    this.enabledPlugins.delete(pluginId);
  }

  /**
   * 移除插件注册的所有能力（回滚用）。
   * 遍历所有注册项，删除 sourcePluginId 匹配的。
   */
  removePlugin(pluginId: string): void {
    this.enabledPlugins.delete(pluginId);

    for (const [key, entry] of this.providers) {
      if (entry.sourcePluginId === pluginId) {
        this.providers.delete(key);
      }
    }
    for (const [key, entry] of this.tools) {
      if (entry.sourcePluginId === pluginId) {
        this.tools.delete(key);
      }
    }
    for (const [key, entry] of this.hooks) {
      if (entry.sourcePluginId === pluginId) {
        this.hooks.delete(key);
      }
    }
  }
}
