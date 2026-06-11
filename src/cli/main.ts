#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { loadProviderConfig } from "../config/load-provider-config.js";
import { FakeAgentLoopProvider } from "../providers/fake.js";
import type { ChatMessage } from "../providers/contract.js";
import { RuntimeError } from "../providers/errors.js";
import { AgentRuntime } from "../runtime/agent-runtime.js";
import type { RuntimeEvent, RuntimeOutput, ToolDefinition } from "../runtime/contracts.js";
import type { ApprovalDecision, ToolExecutor, ToolIntent } from "../runtime/contracts.js";
import { runChatTurn } from "../runtime/run-chat-turn.js";
import { bashExecutor } from "../runtime/tools/bash.js";
import { readFileExecutor } from "../runtime/tools/read-file.js";
import { editFileExecutor } from "../runtime/tools/edit-file.js";

const SYSTEM_PROMPT = "你是一个谨慎的 CLI 编程助手。先分析，不要假装已经执行命令。";
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

  // 注册真实工具 executor
  const executors: ToolExecutor[] = [bashExecutor, readFileExecutor, editFileExecutor];

  const config = loadProviderConfig(process.env);
  const runtime = new AgentRuntime({
    provider: config.provider,
    model: config.model,
    systemPrompt: SYSTEM_PROMPT,
    tools: realM0Tools,
    toolExecutors: executors,
    approver: cliApprover,
  });

  for await (const event of runtime.send({ text: userInput })) {
    printRuntimeOutput(event);
  }

  output.write("\n--------------- [event log] ---------------\n");
  for (const event of runtime.getEvents()) {
    printLoopEvent(event);
  }

  output.write(`\n[status] ${runtime.getState().status}\n`);
}

/**
 * CLI approval function: auto-allow read-only tools, ask user for write/execute tools.
 */
async function cliApprover(intent: ToolIntent, executor: ToolExecutor): Promise<ApprovalDecision> {
  // Auto-allow read-only tools
  if (executor.name === "read_file") {
    return { type: "allow", reason: "Read-only tool, auto-allowed." };
  }

  // Ask user for confirmation
  const readline = createInterface({ input, output });
  try {
    output.write(`\n--- [Approval Required] ---\n`);
    output.write(`Tool: ${intent.toolName}\n`);
    output.write(`Input: ${JSON.stringify(intent.input, null, 2)}\n`);

    const answer = await readline.question(`Allow this tool? (y/N) `);
    const trimmed = answer.trim().toLowerCase();
    if (trimmed === "y" || trimmed === "yes") {
      return { type: "allow", reason: "User approved." };
    }
    return { type: "deny", reason: "User denied." };
  } finally {
    readline.close();
  }
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
  for (const event of runtime.getEvents()) {
    printLoopEvent(event);
  }

  output.write(`\nstatus: ${runtime.getState().status}\n`);
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

const realM0Tools: ToolDefinition[] = [
  {
    name: "bash",
    description: "Execute a shell command in the project directory. Use this to run tests, build, lint, or any CLI operation.",
    risk: "execute",
    isReadOnly: false,
    isConcurrencySafe: false
  },
  {
    name: "read_file",
    description: "Read a file from the project and return its contents.",
    risk: "read",
    isReadOnly: true,
    isConcurrencySafe: true
  },
  {
    name: "edit_file",
    description: "Apply an edit (replace, insert, or delete) to a file in the project.",
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
      output.write(`\ntext: ${event.text}`);
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
  switch (event.type) {
    case "user.message":
      output.write(`[user] ${event.text}\n`);
      break;

    case "run.started":
      output.write(`[run_started] run id: ${event.runId}\n`);
      break;

    case "model.text.delta":
      output.write(`[model_text_delta] ${event.text}\n`);
      break;

    case "model.tool.intent":
      output.write(`[model_tool_intent] ${event.intent.toolName} ${JSON.stringify(event.intent.input)}\n`);
      break;

    case "model.usage":
      output.write(`[usage] ${JSON.stringify(event.usage)}\n`);
      break;

    case "model.final":
      output.write(`[final] ${event.text}\n`);
      break;

    case "run.finished":
      output.write(`[run_finished] ${event.status}\n`);
      break;

    case "runtime.error":
      output.write(`[runtime_error] ${event.error.message}\n`);
      break;

    case "tool.validation":
      output.write(`[tool_validation] ${event.toolName} ok=${event.result.ok}\n`);
      break;

    case "tool.approval":
      output.write(`[tool_approval] ${event.toolName} decision=${event.decision.type}\n`);
      break;

    case "tool.execution.started":
      output.write(`[tool_execution_started] ${event.toolName}\n`);
      break;

    case "tool.execution.completed":
      output.write(`[tool_execution_completed] ${event.toolName} type=${event.result.type} duration=${event.result.durationMs}ms\n`);
      break;

    case "tool.observation":
      output.write(`[tool_observation] ${event.observation.content.slice(0, 200)}\n`);
      break;
  }
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
