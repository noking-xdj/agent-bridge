import { z } from "zod";
import type { AgentBridge } from "../bridge/agent-bridge.js";

export const codexDelegateSchema = {
  task: z.string().describe("Description of the task to delegate to Codex"),
  cwd: z.string().optional().describe("Working directory for the task"),
  waitForCompletion: z
    .boolean()
    .default(true)
    .describe("Whether to wait for task completion"),
  model: z.string().optional().describe("Model override for Codex"),
  context: z.string().optional().describe("Additional context to include"),
};

export function codexDelegateDescription(): string {
  return "Delegate a task to the Codex agent. Codex will autonomously execute the task (writing code, running commands, etc.) and return the result.";
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

  // Create task record
  const task = session.createTask(args.task);

  // Build context string
  let contextStr = args.context;
  const sharedContext = session.context.toPromptString();
  if (sharedContext) {
    contextStr = contextStr
      ? `${sharedContext}\n\n${contextStr}`
      : sharedContext;
  }

  // Start the turn
  const result = await bridge.executeTurn(
    session,
    task,
    args.task,
    contextStr,
    args.waitForCompletion !== false,
  );

  return result;
}
