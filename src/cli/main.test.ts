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
  assert.match(stdout, /observation: fake_test failed/);
  assert.match(stdout, /tool_intent: fake_read_file/);
  assert.match(stdout, /tool_intent: fake_edit_file/);
  assert.match(stdout, /observation: fake_test ok/);
  assert.match(stdout, /final: 已修复失败测试/);
  assert.match(stdout, /stopReason: final/);
});
