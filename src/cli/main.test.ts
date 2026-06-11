import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("CLI --loop runs the fake Agent Loop demo", async () => {
  const cliPath = join(process.cwd(), "dist/cli/main.js");
  const { stdout } = await execFileAsync(process.execPath, [
    cliPath,
    "--loop",
    "帮我看看测试为什么失败，并把它修好。"
  ]);

  assert.match(stdout, /tool_intent: fake_test/);
  assert.match(stdout, /model_tool_intent: fake_test/);
  assert.match(stdout, /run_finished: waiting_for_tool/);
  assert.match(stdout, /status: waiting_for_tool/);
  assert.doesNotMatch(stdout, /observation:/);
  assert.doesNotMatch(stdout, /final: 已修复失败测试/);
});
