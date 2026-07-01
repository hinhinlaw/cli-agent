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
    const ok = result.type === "success";
    const summary = ok
      ? `read_file: file read successfully (${result.durationMs}ms${result.truncated ? ", truncated" : ""})`
      : `read_file: read failed`;

    const modelLines: string[] = [];
    modelLines.push(`Tool: read_file`);
    modelLines.push(`Status: ${ok ? "Success" : "Failed"}`);
    modelLines.push(`Duration: ${result.durationMs}ms`);
    modelLines.push("");
    modelLines.push(result.output);
    if (result.truncated) {
      modelLines.push("");
      modelLines.push("(content truncated — file is larger than shown, use offset/limit to read more)");
    }

    const userLines: string[] = [];
    userLines.push(`[read_file] ${ok ? "Success" : "Failed"} (${result.durationMs}ms)`);
    if (result.truncated) userLines.push("(truncated)");

    return {
      ok,
      phase: "execute",
      summary,
      modelText: modelLines.join("\n"),
      userText: userLines.join("\n"),
      toolName: "read_file",
      details: {
        durationMs: result.durationMs,
        truncated: result.truncated
      },
      retryable: true,
      sideEffects: "none"
    };
  }
};
