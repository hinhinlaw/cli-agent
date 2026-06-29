#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { loadProviderConfig } from "../config/load-provider-config.js";
import { FakeAgentLoopProvider } from "../providers/fake.js";
import type { ChatMessage } from "../providers/contract.js";
import { RuntimeError } from "../providers/errors.js";
import { CapabilityRegistry } from "../core/registry.js";
import { HookKernel } from "../plugins/hook-kernel.js";
import { PluginHost } from "../plugins/host.js";
import type { PluginEvent } from "../core/contracts.js";
import { builtinOpenAI } from "../plugins/builtin/provider-openai.js";
import { builtinLocalTools } from "../plugins/builtin/local-tools.js";
import { builtinPolicy } from "../plugins/builtin/policy.js";
import { AgentRuntime } from "../runtime/agent-runtime.js";
import type { RuntimeEvent, RuntimeOutput } from "../runtime/contracts.js";
import { runChatTurn } from "../runtime/run-chat-turn.js";
import type { ToolDefinition } from "../runtime/contracts.js";

const SYSTEM_PROMPT = `你是 CLI 编程助手。你的唯一目标是让测试通过。

工作方式：诊断(bash/read_file) → 修复(edit_file) → 验证(bash npm test) → 循环直到 0 fail。

必须遵守：
1. 找到 bug 后立即调用 edit_file 修改源代码，不准用纯文字描述"应该怎么改"
2. 说"需要修改XX"但不调用 edit_file 是没用的——文字不会改变任何代码
3. 修改完后必须再跑一次测试，确认 # pass 数量增加、# fail 减少
4. 只有当测试报告中 # fail 为 0 时任务才算完成，否则继续循环
5. 每次只调用当前最重要的一个工具

禁止的行为：
- 输出"修复 XXX 文件"然后不调 edit_file 直接结束
- 把诊断结果写成一段分析文字然后停止
- 用文字列出"需要做的事情"代替实际的工具调用`;
const LOOP_SYSTEM_PROMPT =
  "你是一个最小 Agent Loop demo。只使用提供的 fake tools，根据 Observation 决定下一步，直到测试通过后 final。";

async function main(): Promise<void> {
  const parsedArgs = parseArgs(process.argv.slice(2));
  const userInput = await readUserInput(parsedArgs.promptArgs);
  if (parsedArgs.loop) {
    await runLoopDemo(userInput);
    return;
  }

  const config = loadProviderConfig(process.env);
  const messages: ChatMessage[] = [
    {
      role: "system",
      content: SYSTEM_PROMPT
    },
    {
      role: "user",
      content: userInput
    }
  ];

  await runChatTurn({
    provider: config.provider,
    model: config.model,
    messages,
    onTextDelta(delta) {
      output.write(delta);
    }
  });

  output.write("\n");
}

async function runLoopDemo(userInput: string): Promise<void> {
  const providerName = (process.env.LLM_PROVIDER || "").trim();

  if (!providerName || providerName === "fake") {
    await runFakeAgentLoop(userInput);
    return;
  }

  // ── 桥梁层：装配 PluginHost → 加载插件 → 创建 AgentRuntime ──

  const registry = new CapabilityRegistry();
  const hookKernel = new HookKernel(registry);

  // PluginHost 的 onEvent 把 plugin 事件写入 EventBus（暂未接入，后续合并）
  const pluginEvents: PluginEvent[] = [];
  const host = new PluginHost(registry, hookKernel, (event) => {
    pluginEvents.push(event);
    console.log(`[plugin:event] ${event.type} ${event.pluginId}`);
  });

  // 加载 builtin 插件
  await host.load(builtinOpenAI, "builtin");
  await host.load(builtinLocalTools, "builtin");
  await host.load(builtinPolicy, "builtin");

  const config = loadProviderConfig(process.env);
  const runtime = new AgentRuntime({
    registry,
    hookKernel,
    model: config.model,
    systemPrompt: SYSTEM_PROMPT,
  });

  for await (const event of runtime.send({ text: userInput })) {
    printRuntimeOutput(event);
  }

  output.write("\n--------------- [event log] ---------------\n");
  const logLines: string[] = [];
  for (const event of runtime.getEvents()) {
    printLoopEvent(event);
    logLines.push(formatLoopEvent(event));
  }
  const statusLine = `\n[status] ${runtime.getState().status}`;
  output.write(`${statusLine}\n`);
  logLines.push(statusLine);

  // 持久化 event log 到 docs/runs/YYYY-MM-DD HH-MM-SS.txt
  saveRunLog(logLines.join("\n"));
}

async function runFakeAgentLoop(userInput: string): Promise<void> {
  const runtime = new AgentRuntime({
    provider: new FakeAgentLoopProvider(),
    model: "fake-agent-loop-model",
    systemPrompt: LOOP_SYSTEM_PROMPT,
    tools: fakeAgentLoopTools,
  });

  for await (const event of runtime.send({ text: userInput })) {
    printRuntimeOutput(event);
  }

  output.write("\n[event log]\n");
  const fakeLogLines: string[] = [];
  for (const event of runtime.getEvents()) {
    printLoopEvent(event);
    fakeLogLines.push(formatLoopEvent(event));
  }
  const fakeStatusLine = `\nstatus: ${runtime.getState().status}`;
  output.write(`${fakeStatusLine}\n`);
  fakeLogLines.push(fakeStatusLine);
  saveRunLog(fakeLogLines.join("\n"));
}

const fakeAgentLoopTools: ToolDefinition[] = [
  {
    name: "fake_test",
    description: "Run the fake test suite and report whether the sum negative branch bug is still present.",
    risk: "execute",
    isReadOnly: true,
    isConcurrencySafe: false
  },
  {
    name: "fake_read_file",
    description: "Read a fake project file such as src/sum.ts.",
    risk: "read",
    isReadOnly: true,
    isConcurrencySafe: true
  },
  {
    name: "fake_edit_file",
    description: "Apply a fake edit to src/sum.ts.",
    risk: "write",
    isReadOnly: false,
    isConcurrencySafe: false
  }
];

/**
 * 解析命令行参数
 * @param args 
 * @returns 
 */
function parseArgs(args: string[]): { loop: boolean; promptArgs: string[] } {
  const promptArgs: string[] = [];
  let loop = false;

  for (const arg of args) {
    if (arg === "--loop") {
      loop = true;
      continue;
    }
    promptArgs.push(arg);
  }

  return { loop, promptArgs };
}

/**
 * 打印实时output
 * @param event 
 */
function printRuntimeOutput(event: RuntimeOutput): void {
  switch (event.type) {
    case "text.delta":
      output.write(event.text);
      break;

    case "tool.intent":
      output.write(`\ntool_intent: ${event.intent.toolName} ${JSON.stringify(event.intent.input)}\n`);
      break;

    case "status":
      output.write(`\nstatus: ${event.status}\n`);
      break;

    case "error":
      output.write(`\nerror: ${event.error.message}\n`);
      break;
  }
}

/**
 * 打印 event log
 * @param event 
 */
function printLoopEvent(event: RuntimeEvent): void {
  output.write(`${formatLoopEvent(event)}\n`);
}

function formatLoopEvent(event: RuntimeEvent): string {
  switch (event.type) {
    case "user.message":
      return `[user] ${event.text}`;
    case "run.started":
      return `[run_started] run id: ${event.runId}`;
    case "model.text.delta":
      return `[model_text_delta] ${event.text}`;
    case "model.tool.intent":
      return `[model_tool_intent] ${event.intent.toolName} ${JSON.stringify(event.intent.input)}`;
    case "model.usage":
      return `[usage] ${JSON.stringify(event.usage)}`;
    case "model.final":
      return `[final] ${event.text}`;
    case "run.finished":
      return `[run_finished] ${event.status}`;
    case "runtime.error":
      return `[runtime_error] ${event.error.message}`;
    case "tool.validation":
      return `[tool_validation] ${event.toolName} ok=${event.result.ok}`;
    case "tool.approval":
      return `[tool_approval] ${event.toolName} decision=${event.decision.type}`;
    case "tool.execution.started":
      return `[tool_execution_started] ${event.toolName}`;
    case "tool.execution.completed":
      return `[tool_execution_completed] ${event.toolName} type=${event.result.type} duration=${event.result.durationMs}ms`;
    case "tool.observation":
      return `[tool_observation] ${event.observation.content.slice(0, 200)}`;
  }
}

function saveRunLog(content: string): void {
  const dir = join(process.cwd(), "docs", "runs");
  mkdirSync(dir, { recursive: true });
  const filename = formatTimestamp(new Date()) + ".txt";
  const filepath = join(dir, filename);
  writeFileSync(filepath, content, "utf-8");
  output.write(`\n[log saved] ${filepath}\n`);
}

function formatTimestamp(date: Date): string {
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  const h = String(date.getHours()).padStart(2, "0");
  const mi = String(date.getMinutes()).padStart(2, "0");
  const s = String(date.getSeconds()).padStart(2, "0");
  return `${y}-${mo}-${d} ${h}-${mi}-${s}`;
}

async function readUserInput(args: string[]): Promise<string> {
  const inlinePrompt = args.join(" ").trim();
  if (inlinePrompt) {
    return inlinePrompt;
  }

  if (!input.isTTY) {
    const pipedInput = (await readStdin()).trim();
    if (pipedInput) {
      return pipedInput;
    }
  }

  const readline = createInterface({ input, output });
  const answer = await readline.question("你想问模型什么？ ");
  readline.close();
  return answer.trim();
}

async function readStdin(): Promise<string> {
  input.setEncoding("utf8");
  let content = "";

  for await (const chunk of input) {
    content += chunk;
  }

  return content;
}

main().catch((error: unknown) => {
  if (error instanceof RuntimeError) {
    console.error(`\n${error.message}`);
    if (error.providerError) {
      console.error(
        JSON.stringify(
          {
            provider: error.providerError.provider,
            kind: error.providerError.kind,
            retryable: error.providerError.retryable,
            statusCode: error.providerError.statusCode,
            requestId: error.providerError.requestId
          },
          null,
          2
        )
      );
    }
    process.exitCode = 1;
    return;
  }

  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
