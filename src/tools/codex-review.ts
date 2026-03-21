import { z } from "zod";
import type { AgentBridge } from "../bridge/agent-bridge.js";

export const codexReviewSchema = {
  path: z.string().optional().describe("Path to review (file or directory)"),
  instructions: z
    .string()
    .optional()
    .describe("Specific review instructions or focus areas"),
};

export function codexReviewDescription(): string {
  return "Have Codex perform a code review on the specified path.";
}

export async function handleCodexReview(
  bridge: AgentBridge,
  args: { path?: string; instructions?: string },
): Promise<string> {
  const session = bridge.getOrCreateSession();

  if (!session.codexThreadId) {
    const thread = await bridge.codexClient.startThread({
      cwd: process.cwd(),
      approvalPolicy: "full-auto",
      sandbox: bridge.config.codex.sandbox ?? "none",
      model: bridge.config.codex.model,
    });
    session.codexThreadId = thread.id;
    session.status = "active";
  }

  let instruction = "Please review the code";
  if (args.path) {
    instruction += ` at ${args.path}`;
  }
  if (args.instructions) {
    instruction += `. Focus on: ${args.instructions}`;
  }
  instruction +=
    ". Provide a detailed review with any issues, suggestions, and an overall assessment.";

  const task = session.createTask(`Review: ${args.path ?? "cwd"}`);
  return bridge.executeTurn(session, task, instruction, undefined, true);
}
