import { randomUUID } from "node:crypto";
import type { ToolExecutor } from "./contracts.js";

export interface ExecutionPlan {
  invocationId: string;
  toolName: string;
  timeoutMs: number;
  abortSignal?: AbortSignal;
}

export interface SchedulerOptions {
  defaultTimeoutMs?: number;
}

/**
 * M1 最小调度器：全部串行执行。
 * 后续升级到 keyed / parallel queue 时，保留此接口不变。
 */
export class Scheduler {
  private defaultTimeoutMs: number;

  constructor(options: SchedulerOptions = {}) {
    this.defaultTimeoutMs = options.defaultTimeoutMs ?? 120_000; // 2 min
  }

  /** 创建执行计划 */
  plan(toolName: string, timeoutMs?: number, abortSignal?: AbortSignal): ExecutionPlan {
    return {
      invocationId: randomUUID(),
      toolName,
      timeoutMs: timeoutMs ?? this.defaultTimeoutMs,
      abortSignal
    };
  }

  /** 执行工具，带超时和取消 */
  async execute(
    executor: ToolExecutor,
    input: Record<string, unknown>,
    plan: ExecutionPlan
  ): Promise<{ type: "success" | "failed" | "timeout" | "cancelled"; output: string; durationMs: number }> {
    const start = performance.now();

    // 如果已有 abort signal 被触发，直接返回
    if (plan.abortSignal?.aborted) {
      return {
        type: "cancelled",
        output: "Execution cancelled before start.",
        durationMs: 0
      };
    }

    try {
      const timeoutPromise = new Promise<never>((_, reject) => {
        const timer = setTimeout(() => {
          reject(new Error(`Tool "${plan.toolName}" timed out after ${plan.timeoutMs}ms.`));
        }, plan.timeoutMs);
        // 如果外部取消，也 reject
        if (plan.abortSignal) {
          plan.abortSignal.addEventListener("abort", () => {
            clearTimeout(timer);
            reject(new Error(`Tool "${plan.toolName}" was cancelled.`));
          }, { once: true });
        }
      });

      const result = await Promise.race([
        executor.execute(input, plan.abortSignal),
        timeoutPromise
      ]);
      const durationMs = Math.round(performance.now() - start);
      return { ...result, durationMs };
    } catch (error) {
      const durationMs = Math.round(performance.now() - start);
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("timed out")) {
        return { type: "timeout", output: message, durationMs };
      }
      if (message.includes("cancelled")) {
        return { type: "cancelled", output: message, durationMs };
      }
      return { type: "failed", output: message, durationMs };
    }
  }
}
