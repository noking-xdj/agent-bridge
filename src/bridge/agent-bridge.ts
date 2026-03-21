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
  private mcpServer: McpServer;
  private collaborationManager: CollaborationManager | null = null;
  private activeAccumulators = new Map<string, TurnAccumulator>();
  private codexInitialized = false;

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

  /**
   * Get the collaboration manager, lazily creating it.
   * Uses the low-level Server from McpServer for sampling support.
   */
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

  async initializeCodex(): Promise<void> {
    if (this.codexInitialized) return;
    await this.codexClient.initialize();
    this.codexInitialized = true;
  }

  async executeTurn(
    session: BridgeSession,
    task: TaskRecord,
    instruction: string,
    context: string | undefined,
    waitForCompletion: boolean,
  ): Promise<string> {
    // Lazy-init Codex on first use
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

    // Register accumulator for this turn
    this.activeAccumulators.set(turn.id, accumulator);

    if (!waitForCompletion) {
      // Keep accumulator alive — it will be cleaned up when turn/completed fires.
      // Set up a background listener to update task status when done.
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

    // Wait for completion with timeout
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
        // Try to interrupt the turn
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
    await this.codexClient.close();
    await this.mcpServer.close();
  }

  private setupCodexHandlers(): void {
    // Agent message streaming
    this.codexClient.onNotification(
      "item/agentMessage/delta",
      (params) => {
        const p = params as AgentMessageDeltaParams;
        const acc = this.activeAccumulators.get(p.turnId);
        acc?.appendAgentDelta(p);
      },
    );

    // Command output streaming
    this.codexClient.onNotification(
      "item/commandExecution/outputDelta",
      (params) => {
        const p = params as CommandOutputDeltaParams;
        const acc = this.activeAccumulators.get(p.turnId);
        acc?.appendCommandOutput(p);
      },
    );

    // Item completed
    this.codexClient.onNotification("item/completed", (params) => {
      const p = params as ItemCompletedParams;
      const acc = this.activeAccumulators.get(p.turnId);
      acc?.addCompletedItem(p);
    });

    // Turn started
    this.codexClient.onNotification("turn/started", (params) => {
      const p = params as TurnStartedParams;
      logger.info(`Turn started: ${p.turnId}`);
    });

    // Turn completed
    this.codexClient.onNotification("turn/completed", (params) => {
      const p = params as TurnCompletedParams;
      const acc = this.activeAccumulators.get(p.turn.id);
      if (acc) {
        acc.finalize(p);
      }
      logger.info(`Turn completed: ${p.turn.id} (${p.turn.status})`);
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

      // Default: auto-accept
      logger.debug(`Auto-approving: ${method}`);
      return { decision: "accept" } satisfies ApprovalResponse;
    });
  }
}
