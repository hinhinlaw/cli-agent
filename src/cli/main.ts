#!/usr/bin/env node
import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import { loadProviderConfig } from "../config/load-provider-config.js";
import type { ChatMessage } from "../providers/contract.js";
import { RuntimeError } from "../providers/errors.js";
import { runChatTurn } from "../runtime/run-chat-turn.js";

const SYSTEM_PROMPT = "你是一个谨慎的 CLI 编程助手。先分析，不要假装已经执行命令。";

async function main(): Promise<void> {
  const userInput = await readUserInput(process.argv.slice(2));
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
