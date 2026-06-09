#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { loadProviderConfig } from "../config/load-provider-config.js";
import { FakeAgentLoopProvider } from "../providers/fake.js";
import type { ChatMessage } from "../providers/contract.js";
import { RuntimeError } from "../providers/errors.js";
import { runAgentLoop, type AgentLoopEvent, type AgentToolSpec, type ToolRegistry } from "../runtime/run-agent-loop.js";
import { runChatTurn } from "../runtime/run-chat-turn.js";

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
  const state = createFakeAgentProjectState();
  const result = await runAgentLoop({
    model: new FakeAgentLoopProvider(),
    modelName: "fake-agent-loop-model",
    systemPrompt: LOOP_SYSTEM_PROMPT,
    tools: fakeAgentLoopTools,
    messages: [
      {
        role: "user",
        content: userInput
      }
    ],
    toolRegistry: createFakeAgentToolRegistry(state),
    maxTurns: 8
  });

  for (const event of result.events) {
    printLoopEvent(event);
  }

  output.write(`\nstopReason: ${result.stopReason}\n`);
}

interface FakeAgentProjectState {
  sumFixed: boolean;
}

const fakeAgentLoopTools: AgentToolSpec[] = [
  {
    name: "fake_test",
    description: "Run the fake test suite and report whether the sum negative branch bug is still present."
  },
  {
    name: "fake_read_file",
    description: "Read a fake project file such as src/sum.ts."
  },
  {
    name: "fake_edit_file",
    description: "Apply a fake edit to src/sum.ts."
  }
];

function createFakeAgentProjectState(): FakeAgentProjectState {
  return { sumFixed: false };
}

function createFakeAgentToolRegistry(state: FakeAgentProjectState): ToolRegistry {
  return {
    fake_test: {
      execute() {
        if (state.sumFixed) {
          return {
            ok: true,
            summary: "node --test dist/sum.test.js passed.",
            evidence: "2 tests passed: adds positive numbers; adds negative and positive numbers"
          };
        }

        return {
          ok: false,
          summary: "node --test dist/sum.test.js failed.",
          evidence: "adds negative and positive numbers: expected 4, actual 3",
          errorType: "test_failure",
          retryable: true
        };
      }
    },
    fake_read_file: {
      execute(inputValue) {
        const path = String(inputValue.path ?? "");
        if (path !== "src/sum.ts") {
          return {
            ok: false,
            summary: `File not found in fake project: ${path}`,
            errorType: "not_found",
            retryable: false
          };
        }

        return {
          ok: true,
          summary: "Read src/sum.ts.",
          evidence: [
            "export function sum(a: number, b: number): number {",
            "  if (a < 0 || b < 0) {",
            "    return a + b - 1;",
            "  }",
            "",
            "  return a + b;",
            "}"
          ].join("\n")
        };
      }
    },
    fake_edit_file: {
      execute(inputValue) {
        const path = String(inputValue.path ?? "");
        if (path !== "src/sum.ts") {
          return {
            ok: false,
            summary: `Refused to edit unknown fake project file: ${path}`,
            errorType: "invalid_path",
            retryable: false
          };
        }

        state.sumFixed = true;
        return {
          ok: true,
          summary: "Replaced the broken negative branch with a single return a + b implementation.",
          evidence: "export function sum(a: number, b: number): number { return a + b; }"
        };
      }
    }
  };
}

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

function printLoopEvent(event: AgentLoopEvent): void {
  switch (event.type) {
    case "turn_start":
      output.write(`\n[turn ${event.turn}]\n`);
      break;

    case "assistant_message":
      output.write(`assistant: ${event.content}\n`);
      break;

    case "tool_intent":
      output.write(`tool_intent: ${event.intent.name} ${JSON.stringify(event.intent.input)}\n`);
      break;

    case "observation":
      output.write(
        [
          `observation: ${event.observation.toolName} ${event.observation.ok ? "ok" : "failed"}`,
          `summary: ${event.observation.summary}`,
          event.observation.evidence ? `evidence: ${event.observation.evidence}` : undefined,
          event.observation.errorType ? `errorType: ${event.observation.errorType}` : undefined
        ]
          .filter((line): line is string => line !== undefined)
          .join("\n") + "\n"
      );
      break;

    case "final":
      output.write(`final: ${event.answer}\n`);
      break;

    case "stop":
      output.write(`stop: ${event.reason}\n`);
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
