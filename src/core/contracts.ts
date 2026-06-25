import type { LlmProvider } from "../providers/contract.js";
import type { ToolExecutor, ToolIntent } from "../runtime/contracts.js";

// ─── Plugin Manifest ───────────────────────────────────────────

export interface PluginManifest {
  id: string; // 唯一标识，如 "builtin/openai"
  name: string; // 人类可读名
  version: string; // semver
  description?: string;
  contributes?: {
    providers?: string[]; // provider id 列表
    tools?: string[]; // tool name 列表
    hooks?: HookPoint[]; // hook point 列表
  };
  requires?: {
    hostVersion?: string; // 最低 host 版本
    capabilities?: string[]; // 需要的能力
  };
  permissions?: PluginPermission[]; // 静态权限声明
  defaultEnabled?: boolean;
}

export interface PluginPermission {
  capability: "filesystem" | "shell" | "network" | "modelApiKey" | "projectPolicy" | string;
  reason?: string;
}

// ─── Contribution ──────────────────────────────────────────────

/** 插件设置完成后返回的贡献声明 */
export interface PluginContribution {
  providers?: ProviderContribution[];
  tools?: ToolContribution[];
  hooks?: HookContribution[];
}

export interface ProviderContribution {
  id: string;
  displayName: string;
  createProvider(config: ProviderConfig): LlmProvider;
}

export interface ProviderConfig {
  apiKey: string;
  baseUrl?: string;
  model?: string;
}

export interface ToolContribution {
  name: string;
  description: string;
  inputSchema: unknown;
  risk: "read" | "write" | "execute" | "network";
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  executor: ToolExecutor;
}

export interface HookContribution {
  point: HookPoint;
  id: string;
  order?: number;
  blocking: boolean; // true=阻断型 gate, false=观察型 observer
  timeoutMs?: number;
  run(input: HookInput): Promise<HookDecision>;
}

// ─── Hook ──────────────────────────────────────────────────────

export type HookPoint = "preToolUse";

export interface HookInput {
  intent: ToolIntent;
  workspacePath?: string;
}

export type HookDecision =
  | { type: "allow"; reason?: string }
  | { type: "deny"; reason: string }
  | { type: "ask"; question: string; risk: "low" | "medium" | "high" };
// amend 延后到后续文章

// ─── Plugin & Setup ────────────────────────────────────────────

export interface PluginModule {
  manifest: PluginManifest;
  setup(ctx: PluginSetupContext): Promise<PluginContribution>;
}

export interface PluginSetupContext {
  logger: PluginLogger;
  config: PluginConfigReader;
  workspace: PluginWorkspace;
}

export interface PluginLogger {
  info(msg: string): void;
  warn(msg: string): void;
  error(msg: string): void;
}

export interface PluginConfigReader {
  get(key: string): string | undefined;
  require(key: string): string;
}

export interface PluginWorkspace {
  cwd: string;
}

// ─── Plugin Source & State ─────────────────────────────────────

export type PluginSource = "builtin" | "test";

export type PluginState = "loaded" | "ready" | "failed";

export interface LoadedPlugin {
  id: string;
  source: PluginSource;
  manifest: PluginManifest;
  module: PluginModule;
  state: PluginState;
  error?: string;
}

// ─── Registry Entry ────────────────────────────────────────────

export interface RegisteredProvider {
  id: string; // "builtin/openai"
  displayName: string;
  sourcePluginId: string;
  sourcePluginSource: PluginSource;
  provider: LlmProvider;
}

export interface RegisteredTool {
  name: string; // "local-tools/bash"
  description: string;
  inputSchema: unknown;
  risk: "read" | "write" | "execute" | "network";
  isReadOnly: boolean;
  isConcurrencySafe: boolean;
  sourcePluginId: string;
  sourcePluginSource: PluginSource;
  executor: ToolExecutor;
}

export interface RegisteredHook {
  id: string; // "local-tools/preToolUse"
  point: HookPoint;
  sourcePluginId: string;
  sourcePluginSource: PluginSource;
  order: number;
  blocking: boolean;
  timeoutMs?: number;
  run(input: HookInput): Promise<HookDecision>;
}

// ─── Plugin Events (写入 EventBus) ──────────────────────────────

export type PluginEvent =
  | { type: "plugin.loaded"; pluginId: string; source: PluginSource }
  | { type: "plugin.ready"; pluginId: string; source: PluginSource }
  | { type: "plugin.failed"; pluginId: string; source: PluginSource; error: string };
