import type { ToolDefinition } from "./contracts.js";

export class ToolRegistry {
  private readonly tools = new Map<string, ToolDefinition>();

  constructor(tools: readonly ToolDefinition[] = []) {
    for (const tool of tools) {
      this.register(tool);
    }
  }

  register(tool: ToolDefinition): void {
    this.tools.set(tool.name, tool);
  }

  list(): ToolDefinition[] {
    return [...this.tools.values()];
  }

  visibleTools(): ToolDefinition[] {
    return this.list().filter((tool) => tool.visible !== false);
  }
}

