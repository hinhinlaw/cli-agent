import { FakeStreamingProvider } from "../providers/fake.js";
import { OpenAIProvider } from "../providers/openai.js";
import type { LlmProvider } from "../providers/contract.js";

export type ProviderName = "fake" | "openai";

export interface ProviderConfig {
  providerName: ProviderName;
  model: string;
  provider: LlmProvider;
}

export function loadProviderConfig(env: NodeJS.ProcessEnv): ProviderConfig {
  const providerName = normalizeProviderName(env.LLM_PROVIDER);
  const model = env.LLM_MODEL ?? defaultModelForProvider(providerName);

  if (providerName === "fake") {
    return {
      providerName,
      model,
      provider: new FakeStreamingProvider()
    };
  }

  const apiKey = env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("OPENAI_API_KEY is required when LLM_PROVIDER=openai.");
  }

  return {
    providerName,
    model,
    provider: new OpenAIProvider({
      apiKey,
      baseUrl: env.LLM_BASE_URL
    })
  };
}

function normalizeProviderName(value: string | undefined): ProviderName {
  if (!value || value === "fake") return "fake";
  if (value === "openai") return "openai";
  throw new Error(`Unsupported LLM_PROVIDER: ${value}`);
}

function defaultModelForProvider(providerName: ProviderName): string {
  if (providerName === "openai") {
    return "gpt-5.5";
  }
  return "fake-model";
}
