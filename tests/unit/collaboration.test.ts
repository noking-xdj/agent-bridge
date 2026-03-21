import { describe, it, expect, vi } from "vitest";
import { CollaborationManager } from "../../src/bridge/collaboration.js";
import { SessionManager } from "../../src/sessions/session-manager.js";

describe("CollaborationManager", () => {
  function createMockMcpServer() {
    return {
      createMessage: vi.fn().mockResolvedValue({
        content: { type: "text", text: "Claude's response" },
        model: "claude",
        role: "assistant",
      }),
    } as any;
  }

  function createMockCodexClient(signalComplete = true) {
    const handlers = new Map<string, Array<(params: unknown) => void>>();
    let turnCounter = 0;

    return {
      onNotification: vi.fn((method: string, handler: (params: unknown) => void) => {
        const existing = handlers.get(method) ?? [];
        existing.push(handler);
        handlers.set(method, existing);
      }),
      offNotification: vi.fn((method: string, handler: (params: unknown) => void) => {
        const existing = handlers.get(method);
        if (existing) {
          const idx = existing.indexOf(handler);
          if (idx !== -1) existing.splice(idx, 1);
        }
      }),
      onServerRequest: vi.fn(),
      startTurn: vi.fn().mockImplementation(async () => {
        const turnId = `turn-${++turnCounter}`;
        const delta = signalComplete
          ? "Codex's response [COLLABORATION_COMPLETE]"
          : "Still working...";

        setTimeout(() => {
          const deltaHandlers = handlers.get("item/agentMessage/delta") ?? [];
          for (const h of deltaHandlers) {
            h({ threadId: "t1", turnId, itemId: "item1", delta });
          }
          const completedHandlers = handlers.get("turn/completed") ?? [];
          for (const h of completedHandlers) {
            h({ threadId: "t1", turn: { id: turnId, threadId: "t1", status: "completed", items: [] } });
          }
        }, 10);

        return { id: turnId, threadId: "t1", status: "in_progress", items: [] };
      }),
      initialize: vi.fn(),
      startThread: vi.fn(),
      close: vi.fn(),
      interruptTurn: vi.fn(),
    } as any;
  }

  it("runs a collaboration round", async () => {
    const mcpServer = createMockMcpServer();
    const codexClient = createMockCodexClient(true);
    const mgr = new CollaborationManager(mcpServer, codexClient);

    const sessionMgr = new SessionManager();
    const session = sessionMgr.createSession();
    session.codexThreadId = "t1";
    session.status = "active";

    const result = await mgr.collaborate(session, {
      goal: "Write a hello world function",
      initialMessage: "Let's start by defining the function signature",
      initiator: "codex",
      maxRounds: 4,
      timeoutMs: 30_000,
    });

    expect(result.rounds.length).toBeGreaterThanOrEqual(1);
    expect(result.outcome).toBe("completed");
    // Verify handlers were cleaned up
    expect(codexClient.offNotification).toHaveBeenCalled();
  });

  it("respects max rounds", async () => {
    const mcpServer = createMockMcpServer();
    const codexClient = createMockCodexClient(false);
    const mgr = new CollaborationManager(mcpServer, codexClient);

    const sessionMgr = new SessionManager();
    const session = sessionMgr.createSession();
    session.codexThreadId = "t1";

    const result = await mgr.collaborate(session, {
      goal: "Test max rounds",
      initialMessage: "Start",
      initiator: "codex",
      maxRounds: 2,
      timeoutMs: 30_000,
    });

    expect(result.totalRounds).toBe(2);
    expect(result.outcome).toBe("max_rounds");
  });

  it("calls onRound callback", async () => {
    const mcpServer = createMockMcpServer();
    const codexClient = createMockCodexClient(true);
    const mgr = new CollaborationManager(mcpServer, codexClient);

    const sessionMgr = new SessionManager();
    const session = sessionMgr.createSession();
    session.codexThreadId = "t1";

    const rounds: any[] = [];
    await mgr.collaborate(
      session,
      {
        goal: "Test callback",
        initialMessage: "Go",
        initiator: "codex",
        maxRounds: 4,
        timeoutMs: 30_000,
      },
      (round) => rounds.push(round),
    );

    expect(rounds.length).toBeGreaterThanOrEqual(1);
    expect(rounds[0].speaker).toBe("codex");
  });
});
