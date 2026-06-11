import { execSync } from "node:child_process";
import type { ExecutionResult, Observation, ToolExecutor, ValidationResult } from "../contracts.js";

export const bashExecutor: ToolExecutor = {
  name: "bash",

  async validate(input: Record<string, unknown>): Promise<ValidationResult> {
    const command = input.command;
    if (typeof command !== "string" || command.trim().length === 0) {
      return { ok: false, errors: ["command field is required and must be a non-empty string"] };
    }
    return { ok: true, validatedInput: { ...input, command: command.trim() } };
  },

  async execute(input: Record<string, unknown>, _signal?: AbortSignal): Promise<ExecutionResult> {
    const command = input.command as string;
    const cwd = (input.cwd as string) ?? process.cwd();
    const timeout = (input.timeout as number) ?? 30_000;
    const start = performance.now();

    try {
      const output = execSync(command, {
        encoding: "utf-8",
        cwd,
        timeout,
        maxBuffer: 10 * 1024 * 1024,
        windowsHide: true
      });
      const durationMs = Math.round(performance.now() - start);
      return { type: "success", output: output || "(no output)", exitCode: 0, durationMs };
    } catch (error: unknown) {
      const durationMs = Math.round(performance.now() - start);
      if (error instanceof Error && "stderr" in error) {
        const stderr = (error as { stderr: string }).stderr ?? "";
        const exitCode = (error as { status?: number }).status;
        return { type: "failed", output: stderr || error.message, exitCode, durationMs, error: error.message };
      }
      return { type: "failed", output: String(error), durationMs, error: String(error) };
    }
  },

  toObservation(result: ExecutionResult): Observation {
    const lines: string[] = [];
    lines.push(`Tool: bash`);
    lines.push(`Status: ${result.type === "success" ? "Success" : "Failed"}`);
    if (result.exitCode !== undefined) {
      lines.push(`Exit code: ${result.exitCode}`);
    }
    lines.push(`Duration: ${result.durationMs}ms`);
    lines.push("");
    lines.push(result.output);

    if (result.truncated) {
      lines.push("");
      lines.push("(output truncated)");
    }

    return { content: lines.join("\n") };
  }
};
