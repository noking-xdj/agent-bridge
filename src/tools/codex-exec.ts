import { z } from "zod";
import type { AgentBridge } from "../bridge/agent-bridge.js";

export const codexExecSchema = {
  command: z
    .string()
    .describe("Shell command for Codex to execute and return results"),
  cwd: z.string().optional().describe("Working directory for command execution"),
};

export function codexExecDescription(): string {
  return `Have Codex execute a shell command and return the output.

Codex runs the command in its sandbox environment. The output is summarized: successful commands show head+tail lines, failed commands preserve more output including error lines.

Args:
  - command (string, required): The shell command to execute.
  - cwd (string, optional): Working directory. Defaults to the bridge's cwd.

Returns:
  Codex's response with the command exit code and summarized output.

Examples:
  - "npm test" → run tests and see results
  - "git log --oneline -10" → recent commit history
  - "find . -name '*.ts' | wc -l" → count TypeScript files`;
}

export async function handleCodexExec(
  bridge: AgentBridge,
  args: { command: string; cwd?: string },
): Promise<string> {
  const session = bridge.getOrCreateSession();

  await bridge.ensureThread(session, { cwd: args.cwd });

  const instruction = `Execute the following command and report the output:\n\`\`\`\n${args.command}\n\`\`\``;
  const task = session.createTask(`Exec: ${args.command}`);
  return bridge.executeTurn(session, task, instruction, undefined, true);
}
