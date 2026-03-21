import type {
  AgentMessageDeltaParams,
  CommandOutputDeltaParams,
  ItemCompletedParams,
  ThreadItem,
  TurnCompletedParams,
  TurnStartParams,
  UserInput,
} from "../codex-protocol/types.js";

/**
 * Accumulates Codex turn notifications and resolves when turn completes.
 */
export class TurnAccumulator {
  private agentMessage = "";
  private commandOutputs = new Map<string, string>();
  private completedItems: ThreadItem[] = [];
  private _resolve: ((result: string) => void) | null = null;
  private _reject: ((error: Error) => void) | null = null;
  private _promise: Promise<string>;
  private _settled = false;

  constructor() {
    this._promise = new Promise<string>((resolve, reject) => {
      this._resolve = resolve;
      this._reject = reject;
    });
  }

  get promise(): Promise<string> {
    return this._promise;
  }

  get settled(): boolean {
    return this._settled;
  }

  appendAgentDelta(params: AgentMessageDeltaParams): void {
    if (this._settled) return;
    this.agentMessage += params.delta;
  }

  appendCommandOutput(params: CommandOutputDeltaParams): void {
    if (this._settled) return;
    const existing = this.commandOutputs.get(params.itemId) ?? "";
    this.commandOutputs.set(params.itemId, existing + params.delta);
  }

  addCompletedItem(params: ItemCompletedParams): void {
    if (this._settled) return;
    this.completedItems.push(params.item);
  }

  finalize(params: TurnCompletedParams): void {
    if (this._settled) return;
    this._settled = true;
    const result = this.formatResult(params);
    this._resolve?.(result);
  }

  reject(error: Error): void {
    if (this._settled) return;
    this._settled = true;
    this._reject?.(error);
  }

  private formatResult(params: TurnCompletedParams): string {
    const sections: string[] = [];

    // Agent message
    if (this.agentMessage.trim()) {
      sections.push(`## Codex Response\n${this.agentMessage.trim()}`);
    }

    // Command executions
    for (const item of this.completedItems) {
      if (item.type === "commandExecution") {
        sections.push(
          `## Command: ${item.command}\n` +
            `Exit code: ${item.exitCode}\n` +
            `\`\`\`\n${item.output}\n\`\`\``,
        );
      } else if (item.type === "fileChange") {
        sections.push(
          `## File Changed: ${item.path}\n\`\`\`diff\n${item.diff}\n\`\`\``,
        );
      }
    }

    // Turn status
    const status = params.turn.status;
    if (status === "failed") {
      sections.push(`## Status: FAILED`);
    }

    return sections.length > 0
      ? sections.join("\n\n")
      : `Codex turn completed with status: ${status}`;
  }
}

/**
 * Builds a Codex TurnStartParams from a task description and optional context.
 */
export function buildTurnParams(
  threadId: string,
  task: string,
  context?: string,
): TurnStartParams {
  let fullText = task;
  if (context) {
    fullText = `${context}\n\n---\n\n${task}`;
  }

  const input: UserInput[] = [
    {
      type: "text",
      text: fullText,
      text_elements: [],
    },
  ];

  return { threadId, input };
}

/**
 * Formats a list of ThreadItems into a readable summary.
 */
export function formatItems(items: ThreadItem[]): string {
  return items
    .map((item) => {
      switch (item.type) {
        case "agentMessage":
          return `[Agent] ${item.text}`;
        case "commandExecution":
          return `[Command] ${item.command} (exit: ${item.exitCode})\n${item.output}`;
        case "fileChange":
          return `[FileChange] ${item.path}\n${item.diff}`;
        case "userMessage":
          return `[User] ${item.text}`;
        case "mcpToolCall":
          return `[MCP Tool] ${item.toolName}: ${item.output}`;
        case "collabAgentToolCall":
          return `[Collab] ${item.toolName}: ${item.output}`;
      }
    })
    .join("\n\n");
}
