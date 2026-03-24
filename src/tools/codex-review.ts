import { z } from "zod";
import type { AgentBridge } from "../bridge/agent-bridge.js";

export const codexReviewSchema = {
  path: z.string().optional().describe("Path to review (file or directory). Omit to review the working directory."),
  instructions: z
    .string()
    .optional()
    .describe("Specific review instructions or focus areas (e.g. 'security', 'performance', 'error handling')"),
};

export function codexReviewDescription(): string {
  return `Have Codex perform a code review on the specified path.

Codex will read the code, analyze it, and provide a detailed review with issues, suggestions, and an overall assessment.

Args:
  - path (string, optional): File or directory to review. Defaults to the current working directory.
  - instructions (string, optional): Focus areas for the review.

Returns:
  Codex's review with findings categorized by severity, suggestions, and assessment.

Examples:
  - path="src/auth/" → review all auth-related code
  - path="src/api/handler.ts", instructions="security and input validation" → focused security review
  - instructions="check for memory leaks and resource cleanup" → specific concern`;
}

export async function handleCodexReview(
  bridge: AgentBridge,
  args: { path?: string; instructions?: string },
): Promise<string> {
  const session = bridge.getOrCreateSession();

  await bridge.ensureThread(session);

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
