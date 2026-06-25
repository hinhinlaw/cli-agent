import type { PluginModule, PluginContribution, PluginSetupContext } from "../../core/contracts.js";
import { bashExecutor } from "../../runtime/tools/bash.js";
import { readFileExecutor } from "../../runtime/tools/read-file.js";
import { editFileExecutor } from "../../runtime/tools/edit-file.js";

/**
 * Builtin Local Tools 插件：bash / read_file / edit_file。
 *
 * 搬家自 main.ts 的 realM0Tools + executors。
 * ToolContribution 里的 inputSchema 来自原 ToolDefinition。
 */
export const builtinLocalTools: PluginModule = {
  manifest: {
    id: "builtin/local-tools",
    name: "Local Tools",
    version: "0.1.0",
    description: "提供本地文件读写、Shell 执行、文件编辑能力。",
    contributes: {
      providers: [],
      tools: ["bash", "read_file", "edit_file"],
      hooks: []
    },
    permissions: [
      { capability: "filesystem", reason: "读写项目文件。" },
      { capability: "shell", reason: "执行 Shell 命令。" }
    ],
    defaultEnabled: true
  },

  setup(ctx: PluginSetupContext): Promise<PluginContribution> {
    ctx.logger.info("Registering local tools: bash, read_file, edit_file...");

    return Promise.resolve({
      providers: [],
      tools: [
        {
          name: "bash",
          description: "Execute a shell command in the project directory.",
          inputSchema: {
            type: "object",
            properties: {
              command: { type: "string", description: "The shell command to execute." },
              description: { type: "string", description: "Short description of what this command does." }
            },
            required: ["command"]
          },
          risk: "execute",
          isReadOnly: false,
          isConcurrencySafe: false,
          executor: bashExecutor
        },
        {
          name: "read_file",
          description: "Read a file from the project and return its contents.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the file to read, relative to project root." }
            },
            required: ["path"]
          },
          risk: "read",
          isReadOnly: true,
          isConcurrencySafe: true,
          executor: readFileExecutor
        },
        {
          name: "edit_file",
          description: "Apply an edit to a file by replacing oldText with newText.",
          inputSchema: {
            type: "object",
            properties: {
              path: { type: "string", description: "Path to the file to edit." },
              oldText: { type: "string", description: "The exact text to replace (must be unique in the file)." },
              newText: { type: "string", description: "The new text to replace oldText with." }
            },
            required: ["path", "oldText", "newText"]
          },
          risk: "write",
          isReadOnly: false,
          isConcurrencySafe: false,
          executor: editFileExecutor
        }
      ],
      hooks: []
    });
  }
};
