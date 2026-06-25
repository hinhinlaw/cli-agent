import type { PluginSource, PluginState } from "../core/contracts.js";

/**
 * 插件简化状态机：loaded → ready → failed
 *
 * 完整状态机（8 状态）延后实现。M1 只需要 3 个状态记录事件。
 */
export function ensureState(
  current: PluginState,
  target: PluginState
): void {
  const validTransitions: Record<PluginState, PluginState[]> = {
    loaded: ["ready", "failed"],
    ready: ["failed"], // ready 后只能变 failed（停止后不回到 loaded）
    failed: [] // 终态
  };

  if (target === current) return;

  if (!validTransitions[current]?.includes(target)) {
    throw new Error(
      `Invalid plugin state transition: ${current} → ${target}.`
    );
  }
}

export interface LifecycleRecord {
  pluginId: string;
  source: PluginSource;
  state: PluginState;
  error?: string;
}
