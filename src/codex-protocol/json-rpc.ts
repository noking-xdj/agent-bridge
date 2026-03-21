import type {
  JsonRpcMessage,
  JsonRpcNotification,
  JsonRpcRequest,
  JsonRpcResponse,
} from "./types.js";

let nextId = 1;

export function createRequest(
  method: string,
  params?: unknown,
): JsonRpcRequest {
  return {
    jsonrpc: "2.0",
    id: nextId++,
    method,
    params,
  };
}

export function createResponse(
  id: string | number,
  result: unknown,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, result };
}

export function createErrorResponse(
  id: string | number,
  code: number,
  message: string,
): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

export function createNotification(
  method: string,
  params?: unknown,
): JsonRpcNotification {
  return { jsonrpc: "2.0", method, params };
}

export function isRequest(msg: JsonRpcMessage): msg is JsonRpcRequest {
  return "id" in msg && "method" in msg;
}

export function isResponse(msg: JsonRpcMessage): msg is JsonRpcResponse {
  return "id" in msg && !("method" in msg);
}

export function isNotification(
  msg: JsonRpcMessage,
): msg is JsonRpcNotification {
  return !("id" in msg) && "method" in msg;
}

export function serialize(msg: JsonRpcMessage): string {
  return JSON.stringify(msg) + "\n";
}

/**
 * Parses newline-delimited JSON-RPC messages from a buffer.
 * Returns parsed messages and any remaining incomplete data.
 */
export function parseBuffer(buffer: string): {
  messages: JsonRpcMessage[];
  remaining: string;
} {
  const messages: JsonRpcMessage[] = [];
  const lines = buffer.split("\n");
  // Last element is either empty (if buffer ends with \n) or an incomplete line
  const remaining = lines.pop() ?? "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      messages.push(JSON.parse(trimmed) as JsonRpcMessage);
    } catch {
      // Log malformed lines instead of silently discarding
      console.error(
        `[AgentBridge] Malformed JSON-RPC: ${trimmed.substring(0, 200)}`,
      );
    }
  }

  return { messages, remaining };
}
