import { z } from "zod";
import type { AgentBridge } from "../bridge/agent-bridge.js";

export const codexAskSchema = {
  question: z.string().describe("Question to ask Codex"),
  sessionId: z.string().optional().describe("Existing session ID to continue a conversation"),
};

export function codexAskDescription(): string {
  return `Ask Codex a question and get a response. Uses an existing session if available, or creates a new one.

Unlike codex_delegate, this tool is intended for questions and analysis — Codex may read files and run commands to answer, but the primary output is its text response.

Args:
  - question (string, required): The question to ask Codex.
  - sessionId (string, optional): Resume a specific session by ID.

Returns:
  Codex's text response, potentially with summarized command output if Codex ran commands to investigate.

Examples:
  - "What does the auth middleware do?" → code explanation
  - "Are there any security issues in src/api/?" → analysis
  - "What's the difference between these two implementations?" → comparison`;
}

export async function handleCodexAsk(
  bridge: AgentBridge,
  args: { question: string; sessionId?: string },
): Promise<string> {
  const session = args.sessionId
    ? bridge.sessionManager.getSession(args.sessionId) ??
      bridge.getOrCreateSession()
    : bridge.getOrCreateSession();

  await bridge.ensureThread(session);

  const task = session.createTask(`Ask: ${args.question}`);
  return bridge.executeTurn(session, task, args.question, undefined, true);
}
