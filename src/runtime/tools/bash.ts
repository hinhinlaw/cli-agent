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
        const stdout = (error as { stdout?: string }).stdout ?? "";
        const stderr = (error as { stderr?: string }).stderr ?? "";
        const combined = [stdout, stderr].filter(Boolean).join("\n");
        const exitCode = (error as { status?: number }).status ?? (error as { code?: number | null }).code ?? undefined;
        return {
          type: "failed",
          output: combined || error.message,
          exitCode,
          durationMs,
          error: error.message
        };
      }
      return { type: "failed", output: String(error), durationMs, error: String(error) };
    }
  },

  toObservation(result: ExecutionResult): Observation {
    const ok = result.type === "success";
    const exitCode = result.exitCode;
    const summary = ok
      ? `bash: command completed (exit ${exitCode ?? 0}, ${result.durationMs}ms)`
      : `bash: command failed (exit ${exitCode ?? "?"}, ${result.durationMs}ms)`;

    const modelLines: string[] = [];
    modelLines.push(`Tool: bash`);
    modelLines.push(`Status: ${ok ? "Success" : "Failed"}`);
    if (exitCode !== undefined) modelLines.push(`Exit code: ${exitCode}`);
    modelLines.push(`Duration: ${result.durationMs}ms`);
    modelLines.push("");
    modelLines.push(result.output);
    if (result.truncated) {
      modelLines.push("");
      modelLines.push("(output truncated, use read_file or narrow down command for full output)");
    }

    const userLines: string[] = [];
    userLines.push(`[bash] ${ok ? "Success" : "Failed"} (exit ${exitCode ?? "?"}, ${result.durationMs}ms)`);
    if (result.truncated) userLines.push("(output truncated)");

    return {
      ok,
      phase: "execute",
      summary,
      modelText: modelLines.join("\n"),
      userText: userLines.join("\n"),
      toolName: "bash",
      details: {
        exitCode,
        durationMs: result.durationMs,
        truncated: result.truncated
      },
      retryable: true,
      sideEffects: "process_executed"
    };
  }
};
