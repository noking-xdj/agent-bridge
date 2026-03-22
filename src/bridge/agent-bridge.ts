import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { CodexClient } from "./codex-client.js";
import { CollaborationManager } from "./collaboration.js";
import { createMcpServer } from "./mcp-server.js";
import {
  TurnAccumulator,
  buildTurnParams,
} from "./protocol-translator.js";
import { SessionManager } from "../sessions/session-manager.js";
import type { BridgeSession, TaskRecord } from "../sessions/session.js";
import type { AgentBridgeConfig } from "../utils/config.js";
import { CodexTimeoutError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";
import type {
  AgentMessageDeltaParams,
  ApprovalResponse,
  CommandOutputDeltaParams,
  ItemCompletedParams,
  TurnCompletedParams,
  TurnStartedParams,
} from "../codex-protocol/types.js";

export class AgentBridge {
  readonly codexClient: CodexClient;
  readonly sessionManager = new SessionManager();
  readonly config: AgentBridgeConfig;
  /** Callback when a Codex thread is created — used by index.ts to update state file. */
  onThreadCreated: ((threadId: string) => void) | null = null;
  private mcpServer: McpServer;
  private collaborationManager: CollaborationManager | null = null;
  private activeAccumulators = new Map<string, TurnAccumulator>();
  private codexInitialized = false;
  private exitHandlerRegistered = false;
  // Single-flight guards to prevent concurrent init/thread creation
  private initPromise: Promise<void> | null = null;
  private threadPromises = new Map<string, Promise<void>>();
  // Notification buffer for turns whose accumulator isn't registered yet
  private notificationBuffer = new Map<
    string,
    Array<{ method: string; params: unknown }>
  >();

  constructor(config: AgentBridgeConfig) {
    this.config = config;
    this.codexClient = new CodexClient({
      binaryPath: config.codex.binaryPath,
      transport: config.codex.transport,
      wsUrl: config.codex.wsUrl,
    });
    this.mcpServer = createMcpServer(this);
    this.setupCodexHandlers();
  }

  getMcpServer(): McpServer {
    return this.mcpServer;
  }

  getCollaborationManager(): CollaborationManager | null {
    if (!this.collaborationManager) {
      const server = this.mcpServer.server;
      this.collaborationManager = new CollaborationManager(
        server,
        this.codexClient,
      );
    }
    return this.collaborationManager;
  }

  getOrCreateSession(): BridgeSession {
    return this.sessionManager.getOrCreateActiveSession();
  }

  /**
   * Initialize Codex with single-flight guard.
   * Multiple concurrent callers share the same promise.
   */
  async initializeCodex(): Promise<void> {
    if (this.codexInitialized) return;
    if (!this.initPromise) {
      this.initPromise = this.codexClient
        .initialize()
        .then(() => {
          this.codexInitialized = true;
          if (!this.exitHandlerRegistered) {
            this.setupProcessExitHandler();
            this.exitHandlerRegistered = true;
          }
        })
        .catch((err) => {
          this.initPromise = null;
          throw err;
        });
    }
    await this.initPromise;
  }

  /**
   * Ensure Codex is initialized and the session has an active thread.
   * Uses single-flight guard per session to prevent duplicate threads.
   */
  async ensureThread(
    session: BridgeSession,
    options?: { cwd?: string; model?: string },
  ): Promise<void> {
    await this.initializeCodex();
    if (session.codexThreadId) return;

    // Single-flight per session
    const existing = this.threadPromises.get(session.id);
    if (existing) {
      await existing;
      return;
    }

    const promise = (async () => {
      if (session.codexThreadId) return; // double-check after await
      const thread = await this.codexClient.startThread({
        cwd: options?.cwd ?? process.cwd(),
        approvalPolicy: "never",
        sandbox: this.config.codex.sandbox ?? "danger-full-access",
        model: options?.model ?? this.config.codex.model,
      });
      session.codexThreadId = thread.id;
      session.status = "active";
      // Notify listener (index.ts updates the state file)
      try {
        this.onThreadCreated?.(thread.id);
      } catch {
        // Best effort
      }
    })();

    this.threadPromises.set(session.id, promise);
    try {
      await promise;
    } finally {
      this.threadPromises.delete(session.id);
    }
  }

  async executeTurn(
    session: BridgeSession,
    task: TaskRecord,
    instruction: string,
    context: string | undefined,
    waitForCompletion: boolean,
  ): Promise<string> {
    await this.initializeCodex();

    if (!session.codexThreadId) {
      throw new Error("Session has no Codex thread");
    }

    const accumulator = new TurnAccumulator();
    const turnParams = buildTurnParams(
      session.codexThreadId,
      instruction,
      context,
    );

    // Start the turn
    const turn = await this.codexClient.startTurn(turnParams);
    task.codexTurnId = turn.id;
    session.updateTask(task.id, { status: "running", codexTurnId: turn.id });

    // Register accumulator THEN flush any buffered notifications
    this.activeAccumulators.set(turn.id, accumulator);
    this.flushNotificationBuffer(turn.id, accumulator);

    if (!waitForCompletion) {
      accumulator.promise
        .then((result) => {
          session.updateTask(task.id, { status: "completed", result });
          this.activeAccumulators.delete(turn.id);
        })
        .catch((err) => {
          const errorMsg = err instanceof Error ? err.message : String(err);
          session.updateTask(task.id, { status: "failed", error: errorMsg });
          this.activeAccumulators.delete(turn.id);
        });

      return JSON.stringify({
        taskId: task.id,
        turnId: turn.id,
        status: "running",
        message:
          "Task delegated to Codex. Use codex_status to check progress.",
      });
    }

    const timeoutMs = this.config.bridge.delegateTimeoutMs;
    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;

    try {
      const result = await Promise.race([
        accumulator.promise,
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(
            () =>
              reject(
                new CodexTimeoutError(
                  `Turn timed out after ${timeoutMs}ms`,
                ),
              ),
            timeoutMs,
          );
        }),
      ]);

      session.updateTask(task.id, { status: "completed", result });
      return result;
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      session.updateTask(task.id, { status: "failed", error: errorMsg });

      if (err instanceof CodexTimeoutError) {
        try {
          await this.codexClient.interruptTurn({
            threadId: session.codexThreadId,
            turnId: turn.id,
          });
        } catch {
          // Best effort
        }
      }

      throw err;
    } finally {
      clearTimeout(timeoutTimer);
      this.activeAccumulators.delete(turn.id);
    }
  }

  async shutdown(): Promise<void> {
    logger.info("Shutting down AgentBridge");
    // Reject all active accumulators
    for (const [turnId, acc] of this.activeAccumulators) {
      acc.reject(new Error("AgentBridge shutting down"));
      this.activeAccumulators.delete(turnId);
    }
    await this.codexClient.close();
    await this.mcpServer.close();
  }

  /**
   * Buffer a notification for a turn that doesn't have an accumulator yet.
   */
  private bufferNotification(
    turnId: string,
    method: string,
    params: unknown,
  ): void {
    const buf = this.notificationBuffer.get(turnId) ?? [];
    buf.push({ method, params });
    this.notificationBuffer.set(turnId, buf);
    // Auto-expire buffer after 120s (matches delegate timeout) to avoid leaks
    // for turns that are never claimed by an accumulator
    if (buf.length === 1) {
      setTimeout(() => this.notificationBuffer.delete(turnId), 120_000);
    }
  }

  /**
   * Replay buffered notifications for a turn into its accumulator.
   */
  private flushNotificationBuffer(
    turnId: string,
    accumulator: TurnAccumulator,
  ): void {
    const buf = this.notificationBuffer.get(turnId);
    if (!buf) return;
    this.notificationBuffer.delete(turnId);
    for (const { method, params } of buf) {
      this.dispatchToAccumulator(method, params, accumulator);
    }
  }

  /**
   * Dispatch a notification to an accumulator based on method name.
   */
  private dispatchToAccumulator(
    method: string,
    params: unknown,
    acc: TurnAccumulator,
  ): void {
    switch (method) {
      case "item/agentMessage/delta":
        acc.appendAgentDelta(params as AgentMessageDeltaParams);
        break;
      case "item/commandExecution/outputDelta":
        acc.appendCommandOutput(params as CommandOutputDeltaParams);
        break;
      case "item/completed":
        acc.addCompletedItem(params as ItemCompletedParams);
        break;
      case "turn/completed":
        acc.finalize(params as TurnCompletedParams);
        break;
    }
  }

  /**
   * Reset bridge state when Codex process exits, allowing re-initialization.
   */
  private setupProcessExitHandler(): void {
    this.codexClient.onProcessExit(() => {
      logger.warn("Codex process exited, resetting bridge state");
      this.codexInitialized = false;
      this.initPromise = null;
      // Reject all active accumulators
      for (const [turnId, acc] of this.activeAccumulators) {
        acc.reject(new Error("Codex process exited"));
        this.activeAccumulators.delete(turnId);
      }
      // Mark all active sessions as error
      for (const session of this.sessionManager.listSessions()) {
        if (session.status === "active") {
          session.status = "error";
          session.codexThreadId = null;
        }
      }
    });
  }

  private setupCodexHandlers(): void {
    const turnNotificationMethods = [
      "item/agentMessage/delta",
      "item/commandExecution/outputDelta",
      "item/completed",
      "turn/completed",
    ];

    for (const method of turnNotificationMethods) {
      this.codexClient.onNotification(method, (params) => {
        // Extract turnId from params
        const p = params as Record<string, unknown>;
        const turnId =
          (p.turnId as string) ??
          ((p.turn as Record<string, unknown>)?.id as string);
        if (!turnId) return;

        const acc = this.activeAccumulators.get(turnId);
        if (acc) {
          this.dispatchToAccumulator(method, params, acc);
        } else {
          // Buffer for later — accumulator may not be registered yet
          this.bufferNotification(turnId, method, params);
        }
      });
    }

    // Turn started (informational only)
    this.codexClient.onNotification("turn/started", (params) => {
      const p = params as TurnStartedParams;
      logger.info(`Turn started: ${p.turnId}`);
    });

    // Auto-approve server requests based on policy
    this.codexClient.onServerRequest(async (_id, method, _params) => {
      const policy = this.config.codex.approvalPolicy;

      if (policy === "decline") {
        return { decision: "decline" } satisfies ApprovalResponse;
      }

      if (policy === "auto-session") {
        return { decision: "acceptForSession" } satisfies ApprovalResponse;
      }

      logger.debug(`Auto-approving: ${method}`);
      return { decision: "accept" } satisfies ApprovalResponse;
    });
  }
}
