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
    .describe("Which agent starts the collaboration (default: 'claude')"),
  maxRounds: z
    .number()
    .int()
    .min(1)
    .max(20)
    .default(6)
    .describe("Maximum number of back-and-forth rounds (default: 6, max: 20)"),
  cwd: z.string().optional().describe("Working directory for Codex"),
};

export function codexCollaborateDescription(): string {
  return `Start a bidirectional collaboration between Claude and Codex. Both agents take turns contributing towards a shared goal, seeing each other's responses and building on them.

The collaboration ends when an agent includes "[COLLABORATION_COMPLETE]" in its response, maxRounds is reached, or timeout occurs. Requires MCP sampling support from the client.

Args:
  - goal (string, required): The shared objective both agents work toward.
  - initialMessage (string, required): The first message to start the conversation.
  - initiator ('claude' | 'codex', optional): Who goes first (default: 'claude').
  - maxRounds (number, optional): Max rounds of back-and-forth (default: 6, max: 20).
  - cwd (string, optional): Working directory for Codex.

Returns:
  Formatted collaboration transcript with all rounds, outcome, and the final message.

Examples:
  - goal="Design and implement a REST API for user management" → collaborative architecture + implementation
  - goal="Debug the failing integration test in tests/api.test.ts" → joint debugging session`;
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

  await bridge.ensureThread(session, { cwd: args.cwd });

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
