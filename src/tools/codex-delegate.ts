import { z } from "zod";
import type { AgentBridge } from "../bridge/agent-bridge.js";

export const codexDelegateSchema = {
  task: z.string().describe("Description of the task to delegate to Codex"),
  cwd: z.string().optional().describe("Working directory for the task"),
  waitForCompletion: z
    .boolean()
    .default(true)
    .describe("Whether to wait for task completion (default: true). Set false for async delegation."),
  model: z.string().optional().describe("Model override for Codex (e.g. 'o4-mini', 'o3')"),
  context: z.string().optional().describe("Additional context to include with the task prompt"),
};

export function codexDelegateDescription(): string {
  return `Delegate a task to the Codex agent for autonomous execution. Codex will write code, run commands, modify files, and return the result.

Args:
  - task (string, required): What Codex should do. Be specific about expected deliverables.
  - cwd (string, optional): Working directory. Defaults to the bridge's cwd.
  - waitForCompletion (boolean, optional): Wait for result (default: true). Set false to run in background.
  - model (string, optional): Override Codex model.
  - context (string, optional): Extra context appended to the prompt. Shared context is auto-included.

Returns:
  - If waitForCompletion=true: Codex's response text with command summaries and file changes.
  - If waitForCompletion=false: JSON with taskId and turnId for tracking via codex_status.

Examples:
  - "Refactor the auth module to use JWT tokens" → full autonomous refactoring
  - "Run the test suite and fix any failures" → iterative fix loop
  - "Add input validation to all API endpoints" → multi-file code changes

Error handling:
  - Returns error if Codex process is not running or connection fails.
  - Times out after the configured delegate timeout (default: 300s).`;
}

export async function handleCodexDelegate(
  bridge: AgentBridge,
  args: {
    task: string;
    cwd?: string;
    waitForCompletion?: boolean;
    model?: string;
    context?: string;
  },
): Promise<string> {
  const session = bridge.getOrCreateSession();

  await bridge.ensureThread(session, { cwd: args.cwd, model: args.model });

  const task = session.createTask(args.task);

  let contextStr = args.context;
  const sharedContext = session.context.toPromptString();
  if (sharedContext) {
    contextStr = contextStr
      ? `${sharedContext}\n\n${contextStr}`
      : sharedContext;
  }

  const result = await bridge.executeTurn(
    session,
    task,
    args.task,
    contextStr,
    args.waitForCompletion !== false,
  );

  return result;
}
