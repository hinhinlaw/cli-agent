/**
 * ToolCallAssembler 负责拼接 streaming tool-call delta。
 *
 * 00-12 的核心组件之一：Provider Runtime 在 streaming 期间按 providerCallId
 * 收集增量 fragment，流结束后产出完整的 tool_intent.proposed 事件。
 *
 * 临时状态，不持有 session state。一次 stream 对应一个 assembler 实例。
 */
export class ToolCallAssembler {
  private calls = new Map<string, AssemblingCall>();

  /**
   * 推入一个 delta fragment。
   * @param providerCallId provider 侧的工具调用 ID（同一调用跨 delta 不变）
   * @param toolName 工具名（可能在第一个 delta 就出现，也可能后补）
   * @param argsText 本次 delta 的参数 JSON 增量文本
   */
  push(providerCallId: string, toolName: string | undefined, argsText: string): void {
    let call = this.calls.get(providerCallId);
    if (!call) {
      call = { providerCallId, toolName: undefined, rawInputText: "" };
      this.calls.set(providerCallId, call);
    }
    if (toolName) {
      call.toolName = toolName;
    }
    call.rawInputText += argsText;
  }

  /**
   * 返回已收集但尚未完成的部分调用（用于产出 tool_intent.delta）。
   */
  getPending(): AssemblingCall[] {
    return [...this.calls.values()];
  }

  /**
   * 标记所有调用为完成，尝试解析 JSON 并返回成功解析的 proposed intent。
   * JSON 解析失败的调用会被跳过（应由 Error Mapper 处理）。
   */
  finalize(): FinalizedCall[] {
    const results: FinalizedCall[] = [];
    for (const call of this.calls.values()) {
      let input: unknown;
      try {
        input = JSON.parse(call.rawInputText || "{}");
      } catch {
        input = undefined; // malformed — skip
      }
      results.push({
        providerCallId: call.providerCallId,
        toolName: call.toolName ?? "unknown",
        rawInputText: call.rawInputText,
        input,
        parseOk: input !== undefined
      });
    }
    return results;
  }
}

export interface AssemblingCall {
  providerCallId: string;
  toolName: string | undefined;
  rawInputText: string;
}

export interface FinalizedCall {
  providerCallId: string;
  toolName: string;
  rawInputText: string;
  input: unknown;
  parseOk: boolean;
}
