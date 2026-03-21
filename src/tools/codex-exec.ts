import { z } from "zod";
import type { AgentBridge } from "../bridge/agent-bridge.js";

export const codexExecSchema = {
  command: z
    .string()
    .describe("Shell command for Codex to execute and return results"),
  cwd: z.string().optional().describe("Working directory"),
};

export function codexExecDescription(): string {
  return "Have Codex execute a shell command and return the output.";
}

export async function handleCodexExec(
  bridge: AgentBridge,
  args: { command: string; cwd?: string },
): Promise<string> {
  const session = bridge.getOrCreateSession();

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

  const instruction = `Execute the following command and report the output:\n\`\`\`\n${args.command}\n\`\`\``;
  const task = session.createTask(`Exec: ${args.command}`);
  return bridge.executeTurn(session, task, instruction, undefined, true);
}
