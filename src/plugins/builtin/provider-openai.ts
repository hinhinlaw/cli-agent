import type { PluginModule, PluginContribution, PluginSetupContext } from "../../core/contracts.js";
import { OpenAIProvider } from "../../providers/openai.js";

/**
 * Builtin Provider 插件：OpenAI 协议兼容的模型供应商。
 *
 * 从环境变量读取配置，贡献一个 Provider。
 */
export const builtinOpenAI: PluginModule = {
  manifest: {
    id: "builtin/openai",
    name: "OpenAI-compatible Provider",
    version: "0.1.0",
    description: "提供 OpenAI 协议兼容的 LLM 调用能力（含 DeepSeek）。",
    contributes: {
      providers: ["openai"],
      tools: [],
      hooks: []
    },
    permissions: [
      { capability: "modelApiKey", reason: "需要 API Key 调用模型。" },
      { capability: "network", reason: "通过 HTTPS 调用远程 API。" }
    ],
    defaultEnabled: true
  },

  setup(ctx: PluginSetupContext): Promise<PluginContribution> {
    ctx.logger.info("Setting up OpenAI-compatible provider...");

    return Promise.resolve({
      providers: [
        {
          id: "openai",
          displayName: "OpenAI / DeepSeek",
          createProvider(config) {
            return new OpenAIProvider({
              apiKey: config.apiKey,
              baseUrl: config.baseUrl ?? "https://api.deepseek.com"
            });
          }
        }
      ],
      tools: [],
      hooks: []
    });
  }
};
