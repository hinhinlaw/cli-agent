import { stdin as input, stdout as output } from "node:process";
import { createInterface } from "node:readline/promises";
import type {
  HookDecision,
  HookInput,
  PluginModule,
  PluginContribution,
  PluginSetupContext
} from "../../core/contracts.js";

/**
 * Builtin Policy 插件：CLI 权限审批 hook。
 *
 * 搬家自 main.ts 的 cliApprover 函数。
 * - read_file → 自动 allow
 * - bash / edit_file → 弹窗 ask 用户
 */
export const builtinPolicy: PluginModule = {
  manifest: {
    id: "builtin/policy",
    name: "CLI Policy Hook",
    version: "0.1.0",
    description: "提供 CLI 交互式工具权限审批。",
    contributes: {
      providers: [],
      tools: [],
      hooks: ["preToolUse"]
    },
    permissions: [],
    defaultEnabled: true
  },

  setup(ctx: PluginSetupContext): Promise<PluginContribution> {
    ctx.logger.info("Registering CLI policy hook...");

    return Promise.resolve({
      providers: [],
      tools: [],
      hooks: [
        {
          point: "preToolUse",
          id: "cli-approval",
          order: 100, // 放在最后，让其他 hook 先过
          blocking: true, // 阻断型 gate：能 deny/ask
          timeoutMs: 30000, // 用户输入需要更长超时
          run: cliApprovalHook
        }
      ]
    });
  }
};

async function cliApprovalHook(hookInput: HookInput): Promise<HookDecision> {
  const toolName = hookInput.intent.toolName;

  // 自动放行只读工具
  if (toolName.endsWith("/read_file") || toolName === "read_file") {
    return { type: "allow", reason: "Read-only tool, auto-allowed." };
  }

  // 其他工具 → 弹窗问用户
  const readline = createInterface({ input, output });
  try {
    output.write(`\n--- [Approval Required] ---\n`);
    output.write(`Tool: ${toolName}\n`);
    output.write(`Input: ${JSON.stringify(hookInput.intent.input, null, 2)}\n`);

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
