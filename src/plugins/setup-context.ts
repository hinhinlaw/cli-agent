import type {
  PluginConfigReader,
  PluginLogger,
  PluginManifest,
  PluginSetupContext,
  PluginSource,
  PluginWorkspace
} from "../core/contracts.js";

/**
 * 创建受限的 Plugin Setup Context。
 *
 * 原则：
 * - setup 阶段只能读配置、建立连接，不能执行工具、不能改 session state
 * - context 不包含"随便执行工具"的入口
 * - context 不包含"直接修改 session state"的入口
 */
export function createSetupContext(
  manifest: PluginManifest,
  source: PluginSource
): PluginSetupContext {
  return {
    logger: createPluginLogger(manifest.id ?? "unknown", source),
    config: createConfigReader(),
    workspace: createWorkspace()
  };
}

function createPluginLogger(pluginId: string, source: PluginSource): PluginLogger {
  const prefix = `[plugin:${source}:${pluginId}]`;
  return {
    info: (msg: string) => console.log(`${prefix} ${msg}`),
    warn: (msg: string) => console.warn(`${prefix} ${msg}`),
    error: (msg: string) => console.error(`${prefix} ${msg}`)
  };
}

function createConfigReader(): PluginConfigReader {
  return {
    get(key: string): string | undefined {
      return process.env[key];
    },
    require(key: string): string {
      const value = process.env[key];
      if (value === undefined) {
        throw new Error(`Required config "${key}" is not set.`);
      }
      return value;
    }
  };
}

function createWorkspace(): PluginWorkspace {
  return {
    cwd: process.cwd()
  };
}
