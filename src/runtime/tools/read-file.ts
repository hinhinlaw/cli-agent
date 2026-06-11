import { existsSync, readFileSync, statSync } from "node:fs";
import type { ExecutionResult, Observation, ToolExecutor, ValidationResult } from "../contracts.js";

const MAX_CONTENT_LENGTH = 8_000;

export const readFileExecutor: ToolExecutor = {
  name: "read_file",

  async validate(input: Record<string, unknown>): Promise<ValidationResult> {
    const path = input.path;
    if (typeof path !== "string" || path.trim().length === 0) {
      return { ok: false, errors: ["path field is required and must be a non-empty string"] };
    }

    if (!existsSync(path)) {
      return { ok: false, errors: [`File not found: ${path}`] };
    }

    const stats = statSync(path);
    if (stats.isDirectory()) {
      return { ok: false, errors: [`Path is a directory, not a file: ${path}`] };
    }

    return { ok: true, validatedInput: { ...input, path: path.trim() } };
  },

  async execute(input: Record<string, unknown>, _signal?: AbortSignal): Promise<ExecutionResult> {
    const path = input.path as string;
    const start = performance.now();

    try {
      let content = readFileSync(path, "utf-8");
      const truncated = content.length > MAX_CONTENT_LENGTH;
      if (truncated) {
        content = content.slice(0, MAX_CONTENT_LENGTH);
      }
      const durationMs = Math.round(performance.now() - start);
      return {
        type: "success",
        output: content,
        durationMs,
        truncated
      };
    } catch (error: unknown) {
      const durationMs = Math.round(performance.now() - start);
      return {
        type: "failed",
        output: String(error),
        durationMs,
        error: String(error)
      };
    }
  },

  toObservation(result: ExecutionResult): Observation {
    const lines: string[] = [];
    lines.push(`Tool: read_file`);
    lines.push(`Status: ${result.type === "success" ? "Success" : "Failed"}`);
    lines.push(`Duration: ${result.durationMs}ms`);
    lines.push("");

    if (result.type === "success") {
      lines.push(result.output);
      if (result.truncated) {
        lines.push("");
        lines.push("(content truncated — file is larger than shown)");
      }
    } else {
      lines.push(result.output);
    }

    return { content: lines.join("\n") };
  }
};
