import type { ChildProcess } from "node:child_process";
import { WebSocket } from "ws";
import { ProcessManager } from "../codex-protocol/process-manager.js";
import {
  createRequest,
  createResponse,
  isNotification,
  isRequest,
  isResponse,
  parseBuffer,
  serialize,
} from "../codex-protocol/json-rpc.js";
import type {
  ApprovalResponse,
  InitializeResult,
  JsonRpcMessage,
  JsonRpcResponse,
  Thread,
  ThreadStartParams,
  Turn,
  TurnInterruptParams,
  TurnStartParams,
} from "../codex-protocol/types.js";
import { CodexConnectionError, CodexTimeoutError } from "../utils/errors.js";
import { logger } from "../utils/logger.js";

type NotificationHandler = (params: unknown) => void;
type ServerRequestHandler = (
  id: string | number,
  method: string,
  params: unknown,
) => Promise<unknown>;

export class CodexClient {
  private processManager: ProcessManager;
  private process: ChildProcess | null = null;
  private ws: WebSocket | null = null;
  private buffer = "";
  private pendingRequests = new Map<
    string | number,
    {
      resolve: (result: unknown) => void;
      reject: (error: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  private notificationHandlers = new Map<string, NotificationHandler[]>();
  private serverRequestHandler: ServerRequestHandler | null = null;
  private processExitHandlers: Array<() => void> = [];
  private initialized = false;

  constructor(
    private config: {
      binaryPath: string;
      transport: "stdio" | "ws";
      wsUrl?: string;
    },
  ) {
    this.processManager = new ProcessManager(config);
  }

  async initialize(): Promise<InitializeResult> {
    if (this.config.transport === "ws" && this.config.wsUrl) {
      // WS mode: spawn app-server listening on WS port, then connect as client
      await this.initializeWebSocket();
    } else {
      // Stdio mode: spawn app-server with stdio transport, communicate via pipes
      this.initializeStdio();
    }

    const result = (await this.sendRequest(
      "initialize",
      {
        clientInfo: {
          name: "AgentBridge",
          version: "0.1.0",
        },
        protocolVersion: "2025-01-01",
      },
      60_000,
    )) as InitializeResult;

    this.sendNotification("initialized");
    this.initialized = true;
    logger.info("Codex initialized:", result.userAgent);
    return result;
  }

  private initializeStdio(): void {
    this.process = this.processManager.start();

    if (!this.process.stdout || !this.process.stdin) {
      throw new CodexConnectionError("Codex process stdio not available");
    }

    this.process.stdout.on("data", (data: Buffer) => {
      this.handleData(data.toString());
    });

    this.process.stdout.on("error", (err) => {
      logger.error("Codex stdout error:", err.message);
    });

    this.process.stdin.on("error", (err) => {
      logger.error("Codex stdin error:", err.message);
    });

    this.process.on("exit", () => {
      this.handleDisconnect();
    });
  }

  private async initializeWebSocket(): Promise<void> {
    const url = this.config.wsUrl!;

    // Step 1: Spawn codex app-server with --listen ws://...
    this.process = this.processManager.start();
    this.process.on("exit", () => {
      this.handleDisconnect();
    });

    // Step 2: Wait for the WS server to be ready, then connect
    logger.info(`Waiting for Codex app-server on ${url}...`);
    await this.connectWebSocketWithRetry(url, 10, 1000);
  }

  private async connectWebSocketWithRetry(
    url: string,
    maxRetries: number,
    delayMs: number,
  ): Promise<void> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        await this.connectWebSocket(url);
        return;
      } catch (err) {
        if (attempt === maxRetries) {
          throw new CodexConnectionError(
            `Failed to connect to Codex WebSocket after ${maxRetries} attempts`,
          );
        }
        logger.debug(`WebSocket connect attempt ${attempt} failed, retrying...`);
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  private connectWebSocket(url: string): Promise<void> {
    return new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(url);

      ws.on("open", () => {
        logger.info("WebSocket connected to Codex app-server");
        this.ws = ws;
        resolve();
      });

      ws.on("message", (data: Buffer | string) => {
        this.handleData(data.toString());
      });

      ws.on("close", () => {
        logger.warn("WebSocket connection closed");
        this.handleDisconnect();
      });

      ws.on("error", (err) => {
        if (!this.ws) {
          reject(err);
        } else {
          logger.error("WebSocket error:", err.message);
        }
      });
    });
  }

  private handleDisconnect(): void {
    this.initialized = false;
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new CodexConnectionError("Codex disconnected"));
    }
    this.pendingRequests.clear();
    for (const handler of this.processExitHandlers) {
      try {
        handler();
      } catch {
        // Best effort
      }
    }
  }

  async startThread(params: ThreadStartParams): Promise<Thread> {
    this.ensureInitialized();
    const result = (await this.sendRequest(
      "thread/start",
      params,
      60_000,
    )) as { thread: Thread };
    return result.thread;
  }

  async startTurn(params: TurnStartParams): Promise<Turn> {
    this.ensureInitialized();
    const result = (await this.sendRequest("turn/start", params)) as {
      turn: Turn;
    };
    return result.turn;
  }

  async interruptTurn(params: TurnInterruptParams): Promise<void> {
    this.ensureInitialized();
    await this.sendRequest("turn/interrupt", params);
  }

  onNotification(method: string, handler: NotificationHandler): void {
    const handlers = this.notificationHandlers.get(method) ?? [];
    handlers.push(handler);
    this.notificationHandlers.set(method, handlers);
  }

  offNotification(method: string, handler: NotificationHandler): void {
    const handlers = this.notificationHandlers.get(method);
    if (!handlers) return;
    const idx = handlers.indexOf(handler);
    if (idx !== -1) handlers.splice(idx, 1);
  }

  onServerRequest(handler: ServerRequestHandler): void {
    this.serverRequestHandler = handler;
  }

  onProcessExit(handler: () => void): void {
    this.processExitHandlers.push(handler);
  }

  async close(): Promise<void> {
    for (const [, pending] of this.pendingRequests) {
      clearTimeout(pending.timer);
      pending.reject(new CodexConnectionError("Client closing"));
    }
    this.pendingRequests.clear();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.processManager.stop();
    this.initialized = false;
  }

  private ensureInitialized(): void {
    if (!this.initialized) {
      throw new CodexConnectionError("Codex client not initialized");
    }
  }

  /**
   * Write data to the transport (stdio or WebSocket).
   */
  private writeToTransport(data: string): boolean {
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN) {
        this.ws.send(data);
        return true;
      }
      return false;
    }
    if (this.process?.stdin?.writable) {
      this.process.stdin.write(data);
      return true;
    }
    return false;
  }

  private async sendRequest(
    method: string,
    params?: unknown,
    timeoutMs = 30_000,
  ): Promise<unknown> {
    const request = createRequest(method, params);
    const data = serialize(request);

    logger.debug("→ Codex:", method, JSON.stringify(params));

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pendingRequests.delete(request.id);
        reject(
          new CodexTimeoutError(
            `Request ${method} timed out after ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this.pendingRequests.set(request.id, {
        resolve: (result) => {
          clearTimeout(timer);
          resolve(result);
        },
        reject: (error) => {
          clearTimeout(timer);
          reject(error);
        },
        timer,
      });

      if (!this.writeToTransport(data)) {
        this.pendingRequests.delete(request.id);
        clearTimeout(timer);
        reject(new CodexConnectionError("Codex transport not writable"));
        return;
      }
    });
  }

  private sendNotification(method: string, params?: unknown): void {
    const notification = { jsonrpc: "2.0" as const, method, params };
    this.writeToTransport(serialize(notification));
  }

  private handleData(data: string): void {
    this.buffer += data;
    const { messages, remaining } = parseBuffer(this.buffer);
    this.buffer = remaining;

    for (const msg of messages) {
      this.handleMessage(msg);
    }
  }

  private handleMessage(msg: JsonRpcMessage): void {
    if (isResponse(msg)) {
      this.handleResponse(msg);
    } else if (isRequest(msg)) {
      logger.debug("← Codex server request:", msg.method);
      this.handleServerRequest(msg.id, msg.method, msg.params);
    } else if (isNotification(msg)) {
      logger.debug("← Codex notification:", msg.method);
      const handlers = this.notificationHandlers.get(msg.method);
      if (handlers) {
        for (const handler of handlers) {
          try {
            handler(msg.params);
          } catch (err) {
            logger.error(
              `Notification handler error for ${msg.method}:`,
              err,
            );
          }
        }
      }
    }
  }

  private handleResponse(msg: JsonRpcResponse): void {
    const pending = this.pendingRequests.get(msg.id);
    if (!pending) return;
    this.pendingRequests.delete(msg.id);

    if (msg.error) {
      pending.reject(
        new CodexConnectionError(
          `Codex error [${msg.error.code}]: ${msg.error.message}`,
        ),
      );
    } else {
      pending.resolve(msg.result);
    }
  }

  private async handleServerRequest(
    id: string | number,
    method: string,
    params: unknown,
  ): Promise<void> {
    let result: unknown;
    if (this.serverRequestHandler) {
      try {
        result = await this.serverRequestHandler(id, method, params);
      } catch (err) {
        logger.error("Server request handler error:", err);
        result = { decision: "decline" };
      }
    } else {
      result = { decision: "accept" } satisfies ApprovalResponse;
    }

    const response = createResponse(id, result);
    this.writeToTransport(serialize(response));
  }
}
