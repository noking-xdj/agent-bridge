import { describe, it, expect } from "vitest";
import {
  TurnAccumulator,
  buildTurnParams,
  formatItems,
} from "../../src/bridge/protocol-translator.js";
import type {
  AgentMessageDeltaParams,
  CommandOutputDeltaParams,
  ItemCompletedParams,
  TurnCompletedParams,
  ThreadItem,
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

  it("accumulates command outputs", async () => {
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

  it("includes file changes", async () => {
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
    expect(result).toContain("[Command] echo hi");
    expect(result).toContain("[FileChange] test.ts");
  });
});
