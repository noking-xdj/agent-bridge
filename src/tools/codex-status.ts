import { z } from "zod";
import type { AgentBridge } from "../bridge/agent-bridge.js";

export const codexStatusSchema = {
  taskId: z
    .string()
    .optional()
    .describe("Specific task ID to check, or omit for all tasks"),
  sessionId: z
    .string()
    .optional()
    .describe("Specific session ID, or omit for active session"),
};

export function codexStatusDescription(): string {
  return "Check the status of delegated tasks and the current Codex session.";
}

export async function handleCodexStatus(
  bridge: AgentBridge,
  args: { taskId?: string; sessionId?: string },
): Promise<string> {
  const session = args.sessionId
    ? bridge.sessionManager.getSession(args.sessionId)
    : bridge.sessionManager.getActiveSession();

  if (!session) {
    return "No active session. Use codex_delegate or codex_ask to start one.";
  }

  if (args.taskId) {
    const task = session.tasks.get(args.taskId);
    if (!task) return `Task ${args.taskId} not found.`;
    return JSON.stringify(
      {
        id: task.id,
        description: task.description,
        status: task.status,
        result: task.result
          ? task.result.substring(0, 500) + (task.result.length > 500 ? "..." : "")
          : null,
        error: task.error,
        startedAt: new Date(task.startedAt).toISOString(),
        completedAt: task.completedAt
          ? new Date(task.completedAt).toISOString()
          : null,
      },
      null,
      2,
    );
  }

  // Return session summary with all tasks
  const tasks = Array.from(session.tasks.values()).map((t) => ({
    id: t.id,
    description: t.description,
    status: t.status,
  }));

  return JSON.stringify(
    { session: session.toSummary(), tasks },
    null,
    2,
  );
}
