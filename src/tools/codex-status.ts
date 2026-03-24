import { z } from "zod";
import type { AgentBridge } from "../bridge/agent-bridge.js";

export const codexStatusSchema = {
  taskId: z
    .string()
    .optional()
    .describe("Specific task ID to check. Omit to list all tasks in the session."),
  sessionId: z
    .string()
    .optional()
    .describe("Specific session ID. Omit to use the active session."),
};

export function codexStatusDescription(): string {
  return `Check the status of delegated tasks and the current Codex session.

Use this after codex_delegate with waitForCompletion=false to poll task progress.

Args:
  - taskId (string, optional): Specific task ID to check. Returns detailed info including partial result.
  - sessionId (string, optional): Session to query. Defaults to the active session.

Returns:
  JSON with session summary and task statuses. For a specific task, includes result preview (first 500 chars).

Error handling:
  - Returns a message if no active session exists.
  - Returns a message if the specified taskId is not found.`;
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
