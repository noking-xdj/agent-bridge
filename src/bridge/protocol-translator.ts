import type {
  AgentMessageDeltaParams,
  CommandExecutionItem,
  ItemCompletedParams,
  McpToolCallItem,
  ThreadItem,
  TurnCompletedParams,
  TurnStartParams,
  UserInput,
} from "../codex-protocol/types.js";

// --- Output summarization helpers ---

const ERROR_KEYWORDS =
  /\b(error|failed|exception|traceback|not found|permission denied|enoent|eacces|fatal|panic|abort)\b/i;

/**
 * Truncate by lines, keeping head + tail lines with a marker in between.
 * Also enforces a maximum character limit per individual line.
 */
function truncateByLines(
  text: string,
  maxLines: number,
  headLines: number,
  tailLines: number,
  maxChars: number,
  maxLineLen = 300,
): string {
  if (text.length <= maxChars && text.split("\n").length <= maxLines) {
    return text;
  }

  const lines = text.split("\n").map((l) =>
    l.length > maxLineLen ? l.slice(0, maxLineLen) + "..." : l,
  );

  if (lines.length <= maxLines) {
    const joined = lines.join("\n");
    return joined.length <= maxChars ? joined : joined.slice(0, maxChars) + "\n...";
  }

  const head = lines.slice(0, headLines);
  const tail = lines.slice(-tailLines);
  const omitted = lines.length - headLines - tailLines;
  let result = [...head, `\n... (${omitted} lines omitted) ...\n`, ...tail].join("\n");
  if (result.length > maxChars) {
    result = result.slice(0, maxChars) + "\n...";
  }
  return result;
}

/**
 * Summarize command execution output based on exit code.
 * - Success: head 6 + tail 2 lines, max 600 chars
 * - Failure: head 5 + tail 20 lines + error keyword lines, max 2500 chars
 */
export function summarizeCommandOutput(item: CommandExecutionItem): string {
  const failed = item.exitCode !== 0 && item.exitCode !== null;
  const output = item.output ?? "";

  if (!output.trim()) {
    return (
      `## Command: ${item.command}\n` +
      `Exit code: ${item.exitCode}\n` +
      `(no output)`
    );
  }

  let summary: string;
  if (failed) {
    // For failures, also extract lines matching error keywords from the middle
    const lines = output.split("\n");
    const headLines = lines.slice(0, 5);
    const tailLines = lines.slice(-20);
    const middleStart = 5;
    const middleEnd = Math.max(middleStart, lines.length - 20);

    const errorLines: string[] = [];
    for (let i = middleStart; i < middleEnd && errorLines.length < 5; i++) {
      if (ERROR_KEYWORDS.test(lines[i])) {
        errorLines.push(lines[i]);
      }
    }

    const parts = [...headLines];
    if (errorLines.length > 0 && middleEnd > middleStart) {
      parts.push(`\n... (${middleEnd - middleStart} lines omitted, ${errorLines.length} error lines extracted) ...`);
      parts.push(...errorLines);
    } else if (middleEnd > middleStart) {
      parts.push(`\n... (${middleEnd - middleStart} lines omitted) ...`);
    }
    if (lines.length > 5) {
      parts.push(...tailLines.slice(tailLines.length === lines.length ? 5 : 0));
    }

    summary = parts
      .map((l) => (l.length > 300 ? l.slice(0, 300) + "..." : l))
      .join("\n");
    if (summary.length > 2500) {
      summary = summary.slice(0, 2500) + "\n...";
    }
  } else {
    summary = truncateByLines(output, 8, 6, 2, 600);
  }

  return (
    `## Command: ${item.command}\n` +
    `Exit code: ${item.exitCode}\n` +
    `\`\`\`\n${summary}\n\`\`\``
  );
}

/**
 * Summarize MCP tool call output.
 * Tries to parse JSON and extract top-level structure; falls back to line truncation.
 */
export function summarizeMcpOutput(item: McpToolCallItem): string {
  const output = item.output ?? "";

  if (!output.trim()) {
    return `## MCP Tool: ${item.toolName}\n(no output)`;
  }

  let summary: string;

  // Try to summarize JSON structurally
  try {
    const parsed = JSON.parse(output);
    if (Array.isArray(parsed)) {
      const preview = parsed
        .slice(0, 2)
        .map((el) => JSON.stringify(el).slice(0, 120));
      summary =
        `Array[${parsed.length}]` +
        (preview.length > 0 ? `\nFirst items:\n${preview.join("\n")}` : "");
      if (parsed.length > 2) summary += "\n...";
    } else if (typeof parsed === "object" && parsed !== null) {
      const keys = Object.keys(parsed);
      const entries: string[] = [];
      for (const key of keys.slice(0, 8)) {
        const val = parsed[key];
        let repr: string;
        if (val === null || val === undefined) {
          repr = String(val);
        } else if (typeof val === "string") {
          repr = val.length > 80 ? `"${val.slice(0, 80)}..."` : `"${val}"`;
        } else if (Array.isArray(val)) {
          repr = `Array[${val.length}]`;
        } else if (typeof val === "object") {
          repr = `{${Object.keys(val).slice(0, 4).join(", ")}${Object.keys(val).length > 4 ? ", ..." : ""}}`;
        } else {
          repr = String(val);
        }
        entries.push(`  ${key}: ${repr}`);
      }
      summary = `{${keys.length} keys}`;
      if (entries.length > 0) summary += `\n${entries.join("\n")}`;
      if (keys.length > 8) summary += "\n  ...";

      // Surface error.message if present
      if (parsed.error?.message) {
        summary = `ERROR: ${parsed.error.message}\n${summary}`;
      }
    } else {
      summary = String(parsed).slice(0, 800);
    }
  } catch {
    // Not JSON — fall back to line-based truncation
    summary = truncateByLines(output, 12, 8, 4, 800);
  }

  return `## MCP Tool: ${item.toolName}\n\`\`\`\n${summary}\n\`\`\``;
}

// --- TurnAccumulator ---

/**
 * Accumulates Codex turn notifications and resolves when turn completes.
 */
export class TurnAccumulator {
  private agentMessage = "";
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

    // Agent message — always include in full (this is the valuable part)
    if (this.agentMessage.trim()) {
      sections.push(`## Codex Response\n${this.agentMessage.trim()}`);
    }

    // Completed items — type-aware summarization
    for (const item of this.completedItems) {
      if (item.type === "commandExecution") {
        sections.push(summarizeCommandOutput(item));
      } else if (item.type === "fileChange") {
        sections.push(
          `## File Changed: ${item.path}\n\`\`\`diff\n${item.diff}\n\`\`\``,
        );
      } else if (item.type === "mcpToolCall") {
        sections.push(summarizeMcpOutput(item));
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
          return summarizeCommandOutput(item).replace(/^## Command: /, "[Command] ");
        case "fileChange":
          return `[FileChange] ${item.path}\n${item.diff}`;
        case "userMessage":
          return `[User] ${item.text}`;
        case "mcpToolCall":
          return summarizeMcpOutput(item).replace(/^## MCP Tool: /, "[MCP Tool] ");
        case "collabAgentToolCall": {
          const fakeItem: McpToolCallItem = { ...item, type: "mcpToolCall" };
          return summarizeMcpOutput(fakeItem).replace(/^## MCP Tool: /, "[Collab] ");
        }
      }
    })
    .join("\n\n");
}
