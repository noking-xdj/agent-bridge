import { z } from "zod";
import type { AgentBridge } from "../bridge/agent-bridge.js";

export const codexAskSchema = {
  question: z.string().describe("Question to ask Codex"),
  sessionId: z.string().optional().describe("Existing session ID to continue"),
};

export function codexAskDescription(): string {
  return "Ask Codex a question and get a response. Uses an existing session if available, or creates a new one.";
}

export async function handleCodexAsk(
  bridge: AgentBridge,
  args: { question: string; sessionId?: string },
): Promise<string> {
  const session = args.sessionId
    ? bridge.sessionManager.getSession(args.sessionId) ??
      bridge.getOrCreateSession()
    : bridge.getOrCreateSession();

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

  const task = session.createTask(`Ask: ${args.question}`);
  return bridge.executeTurn(session, task, args.question, undefined, true);
}
