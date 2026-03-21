import { EventEmitter } from "node:events";

export interface BridgeEvents {
  "codex:ready": [];
  "codex:exit": [code: number | null];
  "codex:error": [error: Error];
  "codex:notification": [method: string, params: unknown];
  "codex:server-request": [id: string | number, method: string, params: unknown];
  "session:created": [sessionId: string];
  "session:completed": [sessionId: string];
  "task:updated": [taskId: string, status: string];
}

export class TypedEventEmitter extends EventEmitter {
  override emit<K extends keyof BridgeEvents>(
    event: K,
    ...args: BridgeEvents[K]
  ): boolean {
    return super.emit(event, ...args);
  }

  override on<K extends keyof BridgeEvents>(
    event: K,
    listener: (...args: BridgeEvents[K]) => void,
  ): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }
}
