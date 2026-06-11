import { randomUUID } from "node:crypto";
import type { ApprovalDecision, ExecutionResult, Observation, ToolExecutor, ToolIntent, ValidationResult } from "./contracts.js";

export type ApproverFn = (
  intent: ToolIntent,
  executor: ToolExecutor
) => Promise<ApprovalDecision>;

export interface HandleToolIntentArgs {
  intent: ToolIntent;
  executorMap: Map<string, ToolExecutor>;
  approver?: ApproverFn;
  abortSignal?: AbortSignal;
}

export interface ToolPipelineEvents {
  validation: { type: "tool.validation"; runId: string; intentId: string; toolName: string; result: ValidationResult };
  approval: { type: "tool.approval"; runId: string; intentId: string; toolName: string; decision: ApprovalDecision };
  executionStarted: { type: "tool.execution.started"; runId: string; invocationId: string; toolName: string; input: Record<string, unknown> };
  executionCompleted: { type: "tool.execution.completed"; runId: string; invocationId: string; toolName: string; result: ExecutionResult };
  observation: { type: "tool.observation"; runId: string; intentId: string; observation: Observation };
}

/**
 * Run the 5-stage tool pipeline:
 *   lookup executor -> validate -> approve -> execute -> toObservation
 *
 * Returns the events produced by each stage so the caller can append them
 * to an event bus. The final Observation is also returned directly.
 */
export async function handleToolIntent(
  args: HandleToolIntentArgs
): Promise<{ events: ToolPipelineEvents; observation: Observation }> {
  const runId = randomUUID();
  const { intent, executorMap, approver, abortSignal } = args;

  // 1. Lookup executor
  const executor = executorMap.get(intent.toolName);
  if (!executor) {
    const obs: Observation = {
      content: `Error: No executor registered for tool "${intent.toolName}". Available tools: ${[...executorMap.keys()].join(", ")}`
    };
    return {
      events: {
        validation: null as unknown as ToolPipelineEvents["validation"],
        approval: null as unknown as ToolPipelineEvents["approval"],
        executionStarted: null as unknown as ToolPipelineEvents["executionStarted"],
        executionCompleted: null as unknown as ToolPipelineEvents["executionCompleted"],
        observation: { type: "tool.observation", runId, intentId: intent.intentId, observation: obs }
      },
      observation: obs
    };
  }

  // 2. Validate
  const validation = await executor.validate(intent.input);
  const validationEvent: ToolPipelineEvents["validation"] = {
    type: "tool.validation",
    runId,
    intentId: intent.intentId,
    toolName: intent.toolName,
    result: validation
  };

  if (!validation.ok) {
    const obs: Observation = {
      content: `Validation failed for tool "${intent.toolName}": ${(validation.errors ?? ["Unknown error"]).join("; ")}`
    };
    return {
      events: {
        validation: validationEvent,
        approval: null as unknown as ToolPipelineEvents["approval"],
        executionStarted: null as unknown as ToolPipelineEvents["executionStarted"],
        executionCompleted: null as unknown as ToolPipelineEvents["executionCompleted"],
        observation: { type: "tool.observation", runId, intentId: intent.intentId, observation: obs }
      },
      observation: obs
    };
  }

  // 3. Approve
  const decision = approver
    ? await approver(intent, executor)
    : { type: "allow" as const };
  const approvalEvent: ToolPipelineEvents["approval"] = {
    type: "tool.approval",
    runId,
    intentId: intent.intentId,
    toolName: intent.toolName,
    decision
  };

  if (decision.type === "deny") {
    const obs: Observation = {
      content: `Tool "${intent.toolName}" was denied: ${decision.reason ?? "No reason given."}`
    };
    return {
      events: {
        validation: validationEvent,
        approval: approvalEvent,
        executionStarted: null as unknown as ToolPipelineEvents["executionStarted"],
        executionCompleted: null as unknown as ToolPipelineEvents["executionCompleted"],
        observation: { type: "tool.observation", runId, intentId: intent.intentId, observation: obs }
      },
      observation: obs
    };
  }

  const validatedInput = validation.validatedInput ?? intent.input;

  // 4. Execute
  const invocationId = randomUUID();
  const executionStartedEvent: ToolPipelineEvents["executionStarted"] = {
    type: "tool.execution.started",
    runId,
    invocationId,
    toolName: intent.toolName,
    input: validatedInput
  };

  const execResult = await executor.execute(validatedInput, abortSignal);

  const executionCompletedEvent: ToolPipelineEvents["executionCompleted"] = {
    type: "tool.execution.completed",
    runId,
    invocationId,
    toolName: intent.toolName,
    result: execResult
  };

  // 5. To Observation
  const observation = executor.toObservation(execResult);
  const observationEvent: ToolPipelineEvents["observation"] = {
    type: "tool.observation",
    runId,
    intentId: intent.intentId,
    observation
  };

  return {
    events: {
      validation: validationEvent,
      approval: approvalEvent,
      executionStarted: executionStartedEvent,
      executionCompleted: executionCompletedEvent,
      observation: observationEvent
    },
    observation
  };
}
