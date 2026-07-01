import { randomUUID } from "node:crypto";
import type { ApprovalDecision, ExecutionResult, Observation, ToolExecutor, ToolIntent, ToolPhase, ValidationResult } from "./contracts.js";
import { Scheduler } from "./scheduler.js";
import { Sandbox, SandboxError } from "./sandbox.js";

export type ApproverFn = (
  intent: ToolIntent,
  executor: ToolExecutor
) => Promise<ApprovalDecision>;

export interface HandleToolIntentArgs {
  intent: ToolIntent;
  executorMap: Map<string, ToolExecutor>;
  approver?: ApproverFn;
  abortSignal?: AbortSignal;
  scheduler?: Scheduler;
  sandbox?: Sandbox;
}

export interface ToolPipelineEvents {
  validation: { type: "tool.validation"; runId: string; intentId: string; toolName: string; result: ValidationResult };
  approval: { type: "tool.approval"; runId: string; intentId: string; toolName: string; decision: ApprovalDecision };
  executionStarted: { type: "tool.execution.started"; runId: string; invocationId: string; toolName: string; input: Record<string, unknown> };
  executionCompleted: { type: "tool.execution.completed"; runId: string; invocationId: string; toolName: string; result: ExecutionResult };
  observation: { type: "tool.observation"; runId: string; intentId: string; observation: Observation };
}

/**
 * 5 阶段工具管线（00-13 升级版）：
 *   lookup executor → validate → approve → schedule & sandbox & execute → toObservation
 *
 * 每个阶段失败都产出结构化的 Observation（含 phase 标记、retryable、sideEffects）。
 */
export async function handleToolIntent(
  args: HandleToolIntentArgs
): Promise<{ events: ToolPipelineEvents; observation: Observation }> {
  const runId = randomUUID();
  const { intent, executorMap, approver, abortSignal } = args;
  const scheduler = args.scheduler ?? new Scheduler();
  const sandbox = args.sandbox ?? new Sandbox();

  // 1. Lookup
  const executor = executorMap.get(intent.toolName);
  if (!executor) {
    const obs = makeObservation(intent.toolName, "lookup", false, {
      summary: `Unknown tool: "${intent.toolName}"`,
      modelText: `Tool "${intent.toolName}" is not available. Available: ${[...executorMap.keys()].join(", ")}`,
      userText: `[${intent.toolName}] Unknown tool`,
      retryable: true,
      sideEffects: "none"
    });
    return { events: emptyPipelineEvents(runId, intent.intentId, obs), observation: obs };
  }

  // 2. Validate
  const validation = await executor.validate(intent.input);
  const validationEvent: ToolPipelineEvents["validation"] = {
    type: "tool.validation", runId, intentId: intent.intentId, toolName: intent.toolName, result: validation
  };

  if (!validation.ok) {
    const obs = makeObservation(intent.toolName, "validate", false, {
      summary: `Validation failed: ${(validation.errors ?? ["unknown"]).join("; ")}`,
      modelText: `Validation failed for tool "${intent.toolName}": ${(validation.errors ?? ["unknown"]).join("\n")}`,
      userText: `[${intent.toolName}] Validation failed`,
      retryable: true,
      sideEffects: "none"
    });
    return {
      events: {
        ...emptyPipelineEvents(runId, intent.intentId, obs),
        validation: validationEvent,
        observation: { type: "tool.observation", runId, intentId: intent.intentId, observation: obs }
      },
      observation: obs
    };
  }

  // 3. Approve
  const decision = approver ? await approver(intent, executor) : { type: "allow" as const };
  const approvalEvent: ToolPipelineEvents["approval"] = {
    type: "tool.approval", runId, intentId: intent.intentId, toolName: intent.toolName, decision
  };

  if (decision.type === "deny") {
    const obs = makeObservation(intent.toolName, "approve", false, {
      summary: `Permission denied: ${decision.reason ?? "no reason given"}`,
      modelText: `Tool "${intent.toolName}" was denied: ${decision.reason ?? "No reason given."}. Execution did not occur.`,
      userText: `[${intent.toolName}] Denied: ${decision.reason ?? ""}`,
      retryable: false,
      sideEffects: "none"
    });
    return {
      events: {
        ...emptyPipelineEvents(runId, intent.intentId, obs),
        validation: validationEvent,
        approval: approvalEvent,
        observation: { type: "tool.observation", runId, intentId: intent.intentId, observation: obs }
      },
      observation: obs
    };
  }

  // if ask — should have been handled by approver (interactive). For now treat as allow.
  const validatedInput = validation.validatedInput ?? intent.input;

  // 4. Schedule + Sandbox check + Execute
  const plan = scheduler.plan(intent.toolName, undefined, abortSignal);

  // Sandbox: validate path if the tool input has a path
  if (typeof validatedInput.path === "string") {
    try {
      validatedInput.path = sandbox.resolvePath(validatedInput.path);
    } catch (error) {
      const obs = makeObservation(intent.toolName, "schedule", false, {
        summary: `Sandbox restriction: ${error instanceof SandboxError ? error.message : String(error)}`,
        modelText: `Tool "${intent.toolName}" blocked by sandbox: ${error instanceof Error ? error.message : String(error)}. Execution did not occur.`,
        userText: `[${intent.toolName}] Blocked by sandbox`,
        retryable: true,
        sideEffects: "none"
      });
      return {
        events: {
          ...emptyPipelineEvents(runId, intent.intentId, obs),
          validation: validationEvent,
          approval: approvalEvent,
          observation: { type: "tool.observation", runId, intentId: intent.intentId, observation: obs }
        },
        observation: obs
      };
    }
  }

  // Sandbox: validate command if the tool input has a command
  if (typeof validatedInput.command === "string") {
    const cmdCheck = sandbox.validateCommand(validatedInput.command);
    if (!cmdCheck.ok) {
      const obs = makeObservation(intent.toolName, "schedule", false, {
        summary: `Sandbox blocked command: ${cmdCheck.reason}`,
        modelText: `Command blocked by sandbox: ${cmdCheck.reason}. Execution did not occur.`,
        userText: `[${intent.toolName}] Command blocked`,
        retryable: true,
        sideEffects: "none"
      });
      return {
        events: {
          ...emptyPipelineEvents(runId, intent.intentId, obs),
          validation: validationEvent,
          approval: approvalEvent,
          observation: { type: "tool.observation", runId, intentId: intent.intentId, observation: obs }
        },
        observation: obs
      };
    }
  }

  const executionStartedEvent: ToolPipelineEvents["executionStarted"] = {
    type: "tool.execution.started", runId, invocationId: plan.invocationId, toolName: intent.toolName, input: validatedInput
  };

  const execResult = await scheduler.execute(executor, validatedInput, plan);

  const executionCompletedEvent: ToolPipelineEvents["executionCompleted"] = {
    type: "tool.execution.completed", runId, invocationId: plan.invocationId, toolName: intent.toolName, result: execResult
  };

  // 5. To Observation
  const observation = executor.toObservation(execResult);
  observation.invocationId = plan.invocationId;

  const observationEvent: ToolPipelineEvents["observation"] = {
    type: "tool.observation", runId, intentId: intent.intentId, observation
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

// ─── Helpers ────────────────────────────────────────────────────────

function makeObservation(
  toolName: string,
  phase: ToolPhase,
  ok: boolean,
  opts: {
    summary: string;
    modelText: string;
    userText: string;
    retryable: boolean;
    sideEffects: Observation["sideEffects"];
  }
): Observation {
  return {
    ok,
    phase,
    summary: opts.summary,
    modelText: opts.modelText,
    userText: opts.userText,
    toolName,
    retryable: opts.retryable,
    sideEffects: opts.sideEffects
  };
}

function emptyPipelineEvents(runId: string, intentId: string, obs: Observation): ToolPipelineEvents {
  return {
    validation: null as unknown as ToolPipelineEvents["validation"],
    approval: null as unknown as ToolPipelineEvents["approval"],
    executionStarted: null as unknown as ToolPipelineEvents["executionStarted"],
    executionCompleted: null as unknown as ToolPipelineEvents["executionCompleted"],
    observation: { type: "tool.observation", runId, intentId, observation: obs }
  };
}
