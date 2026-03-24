import { describe, it, expect } from "vitest";
import {
  TurnAccumulator,
  buildTurnParams,
  formatItems,
  summarizeCommandOutput,
  summarizeMcpOutput,
} from "../../src/bridge/protocol-translator.js";
import type {
  AgentMessageDeltaParams,
  ItemCompletedParams,
  TurnCompletedParams,
  ThreadItem,
  CommandExecutionItem,
  McpToolCallItem,
} from "../../src/codex-protocol/types.js";

describe("TurnAccumulator", () => {
  it("accumulates agent message deltas", async () => {
    const acc = new TurnAccumulator();

    acc.appendAgentDelta({
      threadId: "t1",
      turnId: "turn1",
      itemId: "i1",
      delta: "Hello ",
    });
    acc.appendAgentDelta({
      threadId: "t1",
      turnId: "turn1",
      itemId: "i1",
      delta: "world!",
    });

    acc.finalize({
      threadId: "t1",
      turn: { id: "turn1", threadId: "t1", status: "completed", items: [] },
    });

    const result = await acc.promise;
    expect(result).toContain("Hello world!");
  });

  it("accumulates command outputs via item/completed", async () => {
    const acc = new TurnAccumulator();

    acc.addCompletedItem({
      threadId: "t1",
      turnId: "turn1",
      item: {
        type: "commandExecution",
        id: "cmd1",
        command: "ls -la",
        output: "file1.txt\nfile2.txt",
        exitCode: 0,
      },
    });

    acc.finalize({
      threadId: "t1",
      turn: { id: "turn1", threadId: "t1", status: "completed", items: [] },
    });

    const result = await acc.promise;
    expect(result).toContain("ls -la");
    expect(result).toContain("file1.txt");
  });

  it("includes file changes in full", async () => {
    const acc = new TurnAccumulator();

    acc.addCompletedItem({
      threadId: "t1",
      turnId: "turn1",
      item: {
        type: "fileChange",
        id: "fc1",
        path: "src/main.ts",
        diff: "+console.log('hello')",
      },
    });

    acc.finalize({
      threadId: "t1",
      turn: { id: "turn1", threadId: "t1", status: "completed", items: [] },
    });

    const result = await acc.promise;
    expect(result).toContain("src/main.ts");
    expect(result).toContain("+console.log");
  });

  it("reports failed status", async () => {
    const acc = new TurnAccumulator();

    acc.finalize({
      threadId: "t1",
      turn: { id: "turn1", threadId: "t1", status: "failed", items: [] },
    });

    const result = await acc.promise;
    expect(result).toContain("FAILED");
  });

  it("rejects on error", async () => {
    const acc = new TurnAccumulator();
    acc.reject(new Error("test error"));
    await expect(acc.promise).rejects.toThrow("test error");
  });

  it("preserves agent message in full", async () => {
    const acc = new TurnAccumulator();
    const longMessage = "A".repeat(5000);

    acc.appendAgentDelta({
      threadId: "t1",
      turnId: "turn1",
      itemId: "i1",
      delta: longMessage,
    });

    acc.finalize({
      threadId: "t1",
      turn: { id: "turn1", threadId: "t1", status: "completed", items: [] },
    });

    const result = await acc.promise;
    expect(result).toContain(longMessage);
  });

  it("summarizes MCP tool call output", async () => {
    const acc = new TurnAccumulator();

    acc.addCompletedItem({
      threadId: "t1",
      turnId: "turn1",
      item: {
        type: "mcpToolCall",
        id: "mcp1",
        toolName: "search_repos",
        input: {},
        output: JSON.stringify({ items: [1, 2, 3], total_count: 100 }),
      },
    });

    acc.finalize({
      threadId: "t1",
      turn: { id: "turn1", threadId: "t1", status: "completed", items: [] },
    });

    const result = await acc.promise;
    expect(result).toContain("MCP Tool: search_repos");
    expect(result).toContain("2 keys");
  });
});

describe("summarizeCommandOutput", () => {
  it("shows short output in full for success", () => {
    const item: CommandExecutionItem = {
      type: "commandExecution",
      id: "1",
      command: "echo hi",
      output: "hi",
      exitCode: 0,
    };
    const result = summarizeCommandOutput(item);
    expect(result).toContain("echo hi");
    expect(result).toContain("hi");
    expect(result).toContain("Exit code: 0");
  });

  it("truncates long success output to ~8 lines", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const item: CommandExecutionItem = {
      type: "commandExecution",
      id: "1",
      command: "long-command",
      output: lines.join("\n"),
      exitCode: 0,
    };
    const result = summarizeCommandOutput(item);
    expect(result).toContain("line 1");
    expect(result).toContain("line 50");
    expect(result).toContain("omitted");
    // Should NOT contain all 50 lines
    expect(result).not.toContain("line 25");
  });

  it("keeps more output for failed commands", () => {
    const lines = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`);
    lines[50] = "Error: something went wrong";
    const item: CommandExecutionItem = {
      type: "commandExecution",
      id: "1",
      command: "failing-cmd",
      output: lines.join("\n"),
      exitCode: 1,
    };
    const result = summarizeCommandOutput(item);
    expect(result).toContain("Exit code: 1");
    // Should extract error keyword line from middle
    expect(result).toContain("Error: something went wrong");
    // Should contain tail lines
    expect(result).toContain("line 100");
  });

  it("handles empty output", () => {
    const item: CommandExecutionItem = {
      type: "commandExecution",
      id: "1",
      command: "true",
      output: "",
      exitCode: 0,
    };
    const result = summarizeCommandOutput(item);
    expect(result).toContain("no output");
  });

  it("treats exitCode null as non-failed", () => {
    const lines = Array.from({ length: 50 }, (_, i) => `line ${i + 1}`);
    const item: CommandExecutionItem = {
      type: "commandExecution",
      id: "1",
      command: "interrupted-cmd",
      output: lines.join("\n"),
      exitCode: null,
    };
    const result = summarizeCommandOutput(item);
    // Should use success truncation (8 lines), not failure (30 lines)
    expect(result).not.toContain("line 25");
  });

  it("enforces 600 char budget for success commands", () => {
    // 50 lines x 300 chars each = 15KB raw, must be capped
    const lines = Array.from({ length: 50 }, (_, i) => `L${i}:${"x".repeat(295)}`);
    const item: CommandExecutionItem = {
      type: "commandExecution",
      id: "1",
      command: "big-output",
      output: lines.join("\n"),
      exitCode: 0,
    };
    const result = summarizeCommandOutput(item);
    // The output section (inside the ```) should respect the 600 char budget
    const codeBlock = result.match(/```\n([\s\S]*?)\n```/)?.[1] ?? "";
    expect(codeBlock.length).toBeLessThanOrEqual(650); // small margin for "..." suffix
  });

  it("enforces 2500 char budget for failed commands", () => {
    const lines = Array.from({ length: 200 }, (_, i) => `L${i}:${"e".repeat(295)}`);
    const item: CommandExecutionItem = {
      type: "commandExecution",
      id: "1",
      command: "huge-fail",
      output: lines.join("\n"),
      exitCode: 1,
    };
    const result = summarizeCommandOutput(item);
    const codeBlock = result.match(/```\n([\s\S]*?)\n```/)?.[1] ?? "";
    expect(codeBlock.length).toBeLessThanOrEqual(2550);
  });
});

describe("summarizeMcpOutput", () => {
  it("summarizes JSON object output", () => {
    const item: McpToolCallItem = {
      type: "mcpToolCall",
      id: "1",
      toolName: "github_search",
      input: {},
      output: JSON.stringify({
        total_count: 42,
        items: [{ name: "repo1" }, { name: "repo2" }],
        incomplete_results: false,
      }),
    };
    const result = summarizeMcpOutput(item);
    expect(result).toContain("github_search");
    expect(result).toContain("3 keys");
    expect(result).toContain("total_count");
    expect(result).toContain("42");
  });

  it("summarizes JSON array output", () => {
    const item: McpToolCallItem = {
      type: "mcpToolCall",
      id: "1",
      toolName: "list_files",
      input: {},
      output: JSON.stringify(["a.ts", "b.ts", "c.ts"]),
    };
    const result = summarizeMcpOutput(item);
    expect(result).toContain("Array[3]");
  });

  it("surfaces error.message from JSON", () => {
    const item: McpToolCallItem = {
      type: "mcpToolCall",
      id: "1",
      toolName: "api_call",
      input: {},
      output: JSON.stringify({
        error: { message: "rate limit exceeded", code: 429 },
      }),
    };
    const result = summarizeMcpOutput(item);
    expect(result).toContain("ERROR: rate limit exceeded");
  });

  it("enforces 800 char budget for non-JSON output", () => {
    const lines = Array.from({ length: 40 }, (_, i) => `L${i}:${"z".repeat(295)}`);
    const item: McpToolCallItem = {
      type: "mcpToolCall",
      id: "1",
      toolName: "big_tool",
      input: {},
      output: lines.join("\n"),
    };
    const result = summarizeMcpOutput(item);
    const codeBlock = result.match(/```\n([\s\S]*?)\n```/)?.[1] ?? "";
    expect(codeBlock.length).toBeLessThanOrEqual(850);
  });

  it("falls back to line truncation for non-JSON", () => {
    const lines = Array.from({ length: 30 }, (_, i) => `output line ${i + 1}`);
    const item: McpToolCallItem = {
      type: "mcpToolCall",
      id: "1",
      toolName: "raw_tool",
      input: {},
      output: lines.join("\n"),
    };
    const result = summarizeMcpOutput(item);
    expect(result).toContain("output line 1");
    expect(result).toContain("omitted");
  });

  it("handles empty output", () => {
    const item: McpToolCallItem = {
      type: "mcpToolCall",
      id: "1",
      toolName: "empty_tool",
      input: {},
      output: "",
    };
    const result = summarizeMcpOutput(item);
    expect(result).toContain("no output");
  });
});

describe("buildTurnParams", () => {
  it("builds params without context", () => {
    const params = buildTurnParams("thread-1", "Do something");
    expect(params.threadId).toBe("thread-1");
    expect(params.input).toHaveLength(1);
    expect(params.input[0].text).toBe("Do something");
  });

  it("builds params with context", () => {
    const params = buildTurnParams("thread-1", "Do something", "Background info");
    expect(params.input[0].text).toContain("Background info");
    expect(params.input[0].text).toContain("Do something");
  });
});

describe("formatItems", () => {
  it("formats mixed items", () => {
    const items: ThreadItem[] = [
      { type: "agentMessage", id: "1", text: "I will help" },
      {
        type: "commandExecution",
        id: "2",
        command: "echo hi",
        output: "hi",
        exitCode: 0,
      },
      {
        type: "fileChange",
        id: "3",
        path: "test.ts",
        diff: "+line",
      },
    ];

    const result = formatItems(items);
    expect(result).toContain("[Agent] I will help");
    expect(result).toContain("[Command]");
    expect(result).toContain("echo hi");
    expect(result).toContain("[FileChange] test.ts");
  });
});
