import { z } from "zod";
import type { AgentBridge } from "../bridge/agent-bridge.js";

export const codexCollaborateSchema = {
  goal: z
    .string()
    .describe(
      "The shared goal for Claude and Codex to collaborate on together",
    ),
  initialMessage: z
    .string()
    .describe("The first message to kick off the collaboration"),
  initiator: z
    .enum(["claude", "codex"])
    .default("claude")
    .describe("Which agent starts the collaboration"),
  maxRounds: z
    .number()
    .min(1)
    .max(20)
    .default(6)
    .describe("Maximum number of back-and-forth rounds"),
  cwd: z.string().optional().describe("Working directory for Codex"),
};

export function codexCollaborateDescription(): string {
  return "Start a bidirectional collaboration between Claude and Codex. Both agents take turns contributing towards a shared goal, seeing each other's responses and building on them.";
}

export async function handleCodexCollaborate(
  bridge: AgentBridge,
  args: {
    goal: string;
    initialMessage: string;
    initiator?: "claude" | "codex";
    maxRounds?: number;
    cwd?: string;
  },
): Promise<string> {
  const session = bridge.getOrCreateSession();

  // Ensure Codex thread exists
  if (!session.codexThreadId) {
    const thread = await bridge.codexClient.startThread({
      cwd: args.cwd ?? process.cwd(),
      approvalPolicy: "full-auto",
      sandbox: bridge.config.codex.sandbox ?? "none",
      model: bridge.config.codex.model,
    });
    session.codexThreadId = thread.id;
    session.status = "active";
  }

  // Lazy-init Codex
  await bridge.initializeCodex();

  const collaboration = bridge.getCollaborationManager();
  if (!collaboration) {
    return "Error: Collaboration manager not available. MCP sampling may not be supported.";
  }

  const task = session.createTask(`Collaborate: ${args.goal}`);
  session.updateTask(task.id, { status: "running" });

  try {
    const result = await collaboration.collaborate(session, {
      goal: args.goal,
      initialMessage: args.initialMessage,
      initiator: args.initiator ?? "claude",
      maxRounds: args.maxRounds ?? 6,
      timeoutMs: bridge.config.bridge.delegateTimeoutMs,
    });

    // Format the result
    const sections: string[] = [
      `## Collaboration Result`,
      `**Goal**: ${args.goal}`,
      `**Outcome**: ${result.outcome}`,
      `**Rounds**: ${result.totalRounds}`,
      "",
      "---",
      "",
    ];

    for (const round of result.rounds) {
      sections.push(
        `### Round ${round.round} — ${round.speaker.toUpperCase()}`,
        round.message,
        "",
      );
    }

    const formatted = sections.join("\n");
    session.updateTask(task.id, { status: "completed", result: formatted });
    return formatted;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    session.updateTask(task.id, { status: "failed", error: msg });
    throw err;
  }
}
