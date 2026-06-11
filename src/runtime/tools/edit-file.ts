import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import type { ExecutionResult, Observation, ToolExecutor, ValidationResult } from "../contracts.js";

const MAX_DIFF_LENGTH = 500;

export const editFileExecutor: ToolExecutor = {
  name: "edit_file",

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

    const oldText = input.oldText;
    if (typeof oldText !== "string" || oldText.length === 0) {
      return { ok: false, errors: ["oldText field is required and must be a non-empty string"] };
    }

    const newText = input.newText;
    if (typeof newText !== "string") {
      return { ok: false, errors: ["newText field is required and must be a string"] };
    }

    // Check that oldText exists and is unique in the file
    const fileContent = readFileSync(path, "utf-8");
    const occurrences = countOccurrences(fileContent, oldText);
    if (occurrences === 0) {
      return { ok: false, errors: [`oldText not found in file: ${path}`] };
    }
    if (occurrences > 1) {
      return { ok: false, errors: [`oldText found ${occurrences} times in file: ${path}. oldText must be unique for a safe replacement.`] };
    }

    return { ok: true, validatedInput: { path: path.trim(), oldText, newText } };
  },

  async execute(input: Record<string, unknown>, _signal?: AbortSignal): Promise<ExecutionResult> {
    const path = input.path as string;
    const oldText = input.oldText as string;
    const newText = input.newText as string;
    const start = performance.now();

    try {
      const fileContent = readFileSync(path, "utf-8");
      const updatedContent = fileContent.replace(oldText, newText);
      writeFileSync(path, updatedContent, "utf-8");

      const durationMs = Math.round(performance.now() - start);

      // Build a diff summary
      const diff = describeDiff(path, oldText, newText, fileContent, updatedContent);

      return {
        type: "success",
        output: diff,
        durationMs
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
    lines.push(`Tool: edit_file`);
    lines.push(`Status: ${result.type === "success" ? "Success" : "Failed"}`);
    lines.push(`Duration: ${result.durationMs}ms`);
    lines.push("");

    if (result.type === "success") {
      lines.push(result.output);
    } else {
      lines.push(`Error: ${result.error ?? result.output}`);
    }

    return { content: lines.join("\n") };
  }
};

function countOccurrences(content: string, pattern: string): number {
  let count = 0;
  let index = 0;
  while (true) {
    index = content.indexOf(pattern, index);
    if (index === -1) break;
    count++;
    index += pattern.length;
  }
  return count;
}

function describeDiff(
  path: string,
  oldText: string,
  newText: string,
  before: string,
  after: string
): string {
  const lines: string[] = [];
  lines.push(`Edited file: ${path}`);
  lines.push(`Replaced ${oldText.length} characters with ${newText.length} characters.`);
  lines.push("");

  // Show surrounding context
  const oldIndex = before.indexOf(oldText);
  const beforeStr = oldText.length <= MAX_DIFF_LENGTH
    ? oldText.slice(0, MAX_DIFF_LENGTH)
    : oldText.slice(0, MAX_DIFF_LENGTH) + "...";
  const afterStr = newText.length <= MAX_DIFF_LENGTH
    ? newText
    : newText.slice(0, MAX_DIFF_LENGTH) + "...";

  lines.push("-" + beforeStr);
  lines.push("+" + afterStr);

  return lines.join("\n");
}
