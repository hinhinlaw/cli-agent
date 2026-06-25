import type { HookDecision, HookInput } from "../core/contracts.js";
import type { CapabilityRegistry } from "../core/registry.js";
import type { ToolIntent } from "../runtime/contracts.js";

export interface HookKernelOptions {
  defaultTimeoutMs?: number;
}

/**
 * HookKernel 管理 hook 注册并执行 preToolUse gate。
 *
 * 关键原则（来自 00-11）：
 * - hook 不是随便触发，有点位、有顺序、有超时
 * - hook 返回结构化决策（allow/deny/ask）
 * - 阻断型 hook 失败 → fail closed（deny）
 * - 观察型 hook 失败 → fail open（跳过，记录日志）
 */
export class HookKernel {
  private defaultTimeoutMs: number;

  constructor(private registry: CapabilityRegistry, options: HookKernelOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 5000;
  }

  /**
   * 运行 preToolUse hook gate。
   * 按 order 排序 hooks → 依次执行 → 遇到 deny/ask 停止 → 全部通过则 allow。
   */
  async runPreToolUse(intent: ToolIntent): Promise<HookDecision> {
    const hooks = this.registry.getVisibleHooks("preToolUse");

    for (const hook of hooks) {
      let decision: HookDecision;
      try {
        decision = await withTimeout(
          hook.run({ intent }),
          hook.timeoutMs ?? this.defaultTimeoutMs
        );
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        // 阻断型 hook 失败 → fail closed（拒绝执行）
        if (hook.blocking) {
          return {
            type: "deny",
            reason: `Policy hook "${hook.id}" failed: ${message}`
          };
        }
        // 观察型 hook 失败 → fail open（跳过，不影响执行）
        continue;
      }

      // deny 或 ask → 立即返回，不运行后续 hooks
      if (decision.type === "deny" || decision.type === "ask") {
        return decision;
      }

      // amend 在 M1 阶段不处理，但如果未来有实现也会阻断
      // allow → 继续下一个 hook
    }

    return { type: "allow" };
  }
}

/**
 * 带超时的异步执行
 */
async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number
): Promise<T> {
  if (timeoutMs <= 0) {
    return promise;
  }

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`Hook timed out after ${timeoutMs}ms.`));
    }, timeoutMs);
  });

  try {
    const result = await Promise.race([promise, timeout]);
    return result;
  } finally {
    if (timer) clearTimeout(timer);
  }
}
