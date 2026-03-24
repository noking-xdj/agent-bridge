import type { Server } from "@modelcontextprotocol/sdk/server/index.js";
import type {
  CreateMessageResult,
  SamplingMessage,
} from "@modelcontextprotocol/sdk/types.js";
import type { CodexClient } from "./codex-client.js";
import { TurnAccumulator, buildTurnParams } from "./protocol-translator.js";
import type { BridgeSession, TaskRecord } from "../sessions/session.js";
import { logger } from "../utils/logger.js";
import type {
  AgentMessageDeltaParams,
  ItemCompletedParams,
  TurnCompletedParams,
} from "../codex-protocol/types.js";

export interface CollaborationOptions {
  maxRounds: number;
  timeoutMs: number;
  goal: string;
  initialMessage: string;
  initiator: "claude" | "codex";
}

export interface CollaborationRound {
  round: number;
  speaker: "claude" | "codex";
  message: string;
  timestamp: number;
}

export interface CollaborationResult {
  rounds: CollaborationRound[];
  finalMessage: string;
  totalRounds: number;
  outcome: "completed" | "max_rounds" | "timeout" | "error";
}

/**
 * Manages a bidirectional collaboration session between Claude and Codex.
 * Both agents can see each other's responses and take turns contributing.
 */
export class CollaborationManager {
  constructor(
    private mcpServer: Server,
    private codexClient: CodexClient,
  ) {}

  /**
   * Run a collaboration loop between Claude and Codex.
   *
   * Flow:
   * 1. One agent starts with the initial message
   * 2. The other agent responds
   * 3. Repeat until: goal is met, max rounds reached, or an agent signals completion
   * 4. Return the full conversation
   */
  async collaborate(
    session: BridgeSession,
    options: CollaborationOptions,
    onRound?: (round: CollaborationRound) => void,
  ): Promise<CollaborationResult> {
    const rounds: CollaborationRound[] = [];
    let currentMessage = options.initialMessage;
    let currentSpeaker = options.initiator;
    let outcome: CollaborationResult["outcome"] = "completed";

    const startTime = Date.now();

    for (let i = 0; i < options.maxRounds; i++) {
      // Check timeout
      if (Date.now() - startTime > options.timeoutMs) {
        outcome = "timeout";
        break;
      }

      logger.info(
        `Collaboration round ${i + 1}/${options.maxRounds}: ${currentSpeaker}`,
      );

      let response: string;

      if (currentSpeaker === "codex") {
        // Send to Codex, get response
        response = await this.sendToCodex(session, currentMessage, options.goal, rounds);
      } else {
        // Send to Claude via MCP sampling, get response
        response = await this.sendToClaude(currentMessage, options.goal, rounds);
      }

      const round: CollaborationRound = {
        round: i + 1,
        speaker: currentSpeaker,
        message: response,
        timestamp: Date.now(),
      };
      rounds.push(round);
      onRound?.(round);

      // Check if the agent signals completion
      if (this.isCompletionSignal(response)) {
        outcome = "completed";
        break;
      }

      // Swap speaker and pass the response as next input
      currentMessage = response;
      currentSpeaker = currentSpeaker === "claude" ? "codex" : "claude";

      // If we've used all rounds
      if (i === options.maxRounds - 1) {
        outcome = "max_rounds";
      }
    }

    return {
      rounds,
      finalMessage: rounds.length > 0 ? rounds[rounds.length - 1].message : "",
      totalRounds: rounds.length,
      outcome,
    };
  }

  /**
   * Send a message to Codex and wait for its response.
   * Codex thread maintains its own conversation history, so we only send
   * the current round's message. On the first round we include the goal
   * and collaboration instructions as context.
   */
  private async sendToCodex(
    session: BridgeSession,
    message: string,
    goal: string,
    history: CollaborationRound[],
  ): Promise<string> {
    if (!session.codexThreadId) {
      throw new Error("No active Codex thread");
    }

    // First round: include goal and instructions as context
    // Subsequent rounds: just pass the message from Claude — Codex's
    // thread already has the prior conversation history
    let fullMessage: string;
    if (history.length === 0) {
      fullMessage =
        `[Collaboration Goal]: ${goal}\n` +
        `[Your Role]: You are Codex, collaborating with Claude to achieve the goal above.\n` +
        `[Instructions]: Respond with your contribution. When the goal is fully achieved, include "[COLLABORATION_COMPLETE]" in your response.\n\n` +
        `[Message from Claude]:\n${message}`;
    } else {
      fullMessage = `[Message from Claude]:\n${message}`;
    }

    const accumulator = new TurnAccumulator();
    const turnParams = buildTurnParams(session.codexThreadId, fullMessage);

    // Register handlers BEFORE startTurn to avoid losing early notifications.
    // We use a temporary turnId holder that gets set once startTurn returns.
    let turnId: string | null = null;
    const pendingEvents: Array<{ method: string; params: unknown }> = [];

    const preCleanup = this.registerTurnHandlersBuffered(
      () => turnId,
      accumulator,
      pendingEvents,
    );

    const turn = await this.codexClient.startTurn(turnParams);
    turnId = turn.id;

    // Flush any events that arrived during startTurn
    for (const evt of pendingEvents) {
      this.dispatchToAccumulator(evt.method, evt.params, accumulator, turn.id);
    }

    const cleanup = () => {
      preCleanup();
    };

    let timeoutTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = await Promise.race([
        accumulator.promise,
        new Promise<never>((_, reject) => {
          timeoutTimer = setTimeout(
            () => reject(new Error("Codex response timeout")),
            120_000,
          );
        }),
      ]);
      return result;
    } catch (err) {
      // Try to interrupt the timed-out turn
      try {
        await this.codexClient.interruptTurn({
          threadId: session.codexThreadId!,
          turnId: turn.id,
        });
      } catch {
        // Best effort
      }
      throw err;
    } finally {
      clearTimeout(timeoutTimer);
      cleanup();
    }
  }

  /**
   * Send a message to Claude via MCP sampling and wait for response.
   * Claude Code manages its own context window, so we only send the
   * system prompt (with goal) and the current message from Codex.
   * Claude Code's sampling handler will place this within its own
   * conversation context automatically.
   */
  private async sendToClaude(
    message: string,
    goal: string,
    _history: CollaborationRound[],
  ): Promise<string> {
    const systemPrompt =
      `You are collaborating with Codex (OpenAI's coding agent) to achieve a shared goal.\n` +
      `[Collaboration Goal]: ${goal}\n` +
      `[Instructions]: Respond with your contribution. When the goal is fully achieved, include "[COLLABORATION_COMPLETE]" in your response.`;

    const messages: SamplingMessage[] = [
      {
        role: "user",
        content: {
          type: "text",
          text: `[Message from Codex]:\n${message}`,
        },
      },
    ];

    let samplingTimer: ReturnType<typeof setTimeout> | undefined;
    try {
      const result = (await Promise.race([
        this.mcpServer.createMessage({
          messages,
          systemPrompt,
          maxTokens: 4096,
        }),
        new Promise<never>((_, reject) => {
          samplingTimer = setTimeout(
            () => reject(new Error("Claude sampling timed out after 120s")),
            120_000,
          );
        }),
      ])) as CreateMessageResult;
      clearTimeout(samplingTimer);

      if (result.content.type === "text") {
        return result.content.text;
      }
      return JSON.stringify(result.content);
    } catch (err) {
      clearTimeout(samplingTimer);
      logger.error("Claude sampling failed:", err);
      throw new Error(
        `Failed to get Claude response: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  /**
   * Register temporary notification handlers for a specific turn.
   * Returns a cleanup function that removes all handlers.
   */
  private registerTurnHandlers(
    turnId: string,
    accumulator: TurnAccumulator,
  ): () => void {
    const registered: Array<{ method: string; handler: (params: unknown) => void }> = [];

    const addHandler = (method: string, handler: (params: unknown) => void) => {
      this.codexClient.onNotification(method, handler);
      registered.push({ method, handler });
    };

    addHandler("item/agentMessage/delta", (params) => {
      const p = params as AgentMessageDeltaParams;
      if (p.turnId === turnId) accumulator.appendAgentDelta(p);
    });

    // item/commandExecution/outputDelta opted-out at protocol level; no handler needed

    addHandler("item/completed", (params) => {
      const p = params as ItemCompletedParams;
      if (p.turnId === turnId) accumulator.addCompletedItem(p);
    });

    addHandler("turn/completed", (params) => {
      const p = params as TurnCompletedParams;
      if (p.turn.id === turnId) accumulator.finalize(p);
    });

    return () => {
      for (const { method, handler } of registered) {
        this.codexClient.offNotification(method, handler);
      }
    };
  }

  /**
   * Register handlers that buffer events until the turnId is known.
   * Events arriving before turnId is set are stored in pendingEvents.
   */
  private registerTurnHandlersBuffered(
    getTurnId: () => string | null,
    accumulator: TurnAccumulator,
    pendingEvents: Array<{ method: string; params: unknown }>,
  ): () => void {
    const registered: Array<{ method: string; handler: (params: unknown) => void }> = [];
    const methods = [
      "item/agentMessage/delta",
      // item/commandExecution/outputDelta opted-out at protocol level
      "item/completed",
      "turn/completed",
    ];

    for (const method of methods) {
      const handler = (params: unknown) => {
        const tid = getTurnId();
        if (!tid) {
          // Turn not started yet — buffer the event
          pendingEvents.push({ method, params });
          return;
        }
        this.dispatchToAccumulator(method, params, accumulator, tid);
      };
      this.codexClient.onNotification(method, handler);
      registered.push({ method, handler });
    }

    return () => {
      for (const { method, handler } of registered) {
        this.codexClient.offNotification(method, handler);
      }
    };
  }

  private dispatchToAccumulator(
    method: string,
    params: unknown,
    accumulator: TurnAccumulator,
    turnId: string,
  ): void {
    const p = params as Record<string, unknown>;
    const eventTurnId =
      (p.turnId as string) ??
      ((p.turn as Record<string, unknown>)?.id as string);
    if (eventTurnId !== turnId) return;

    switch (method) {
      case "item/agentMessage/delta":
        accumulator.appendAgentDelta(params as AgentMessageDeltaParams);
        break;
      // item/commandExecution/outputDelta opted-out at protocol level
      case "item/completed":
        accumulator.addCompletedItem(params as ItemCompletedParams);
        break;
      case "turn/completed":
        accumulator.finalize(params as TurnCompletedParams);
        break;
    }
  }

  /**
   * Check if a response contains a completion signal.
   */
  private isCompletionSignal(response: string): boolean {
    return response.includes("[COLLABORATION_COMPLETE]");
  }
}
