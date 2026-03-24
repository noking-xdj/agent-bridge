// Codex app-server JSON-RPC protocol types

// --- JSON-RPC base types ---
export interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: string | number;
  method: string;
  params?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number;
  result?: unknown;
  error?: JsonRpcError;
}

export interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export type JsonRpcMessage = JsonRpcRequest | JsonRpcResponse | JsonRpcNotification;

// --- Codex-specific types ---

export interface InitializeParams {
  clientInfo: {
    name: string;
    version: string;
  };
  protocolVersion: string;
  capabilities?: {
    experimentalApi?: boolean;
    optOutNotificationMethods?: string[];
  };
}

export interface InitializeResult {
  userAgent: string;
  platformFamily: string;
  platformOs: string;
}

export interface ThreadStartParams {
  cwd: string;
  approvalPolicy?: "untrusted" | "on-failure" | "on-request" | "granular" | "never";
  sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  model?: string;
}

export interface Thread {
  id: string;
  cwd: string;
  status: "active" | "completed" | "error";
}

export interface UserInput {
  type: "text";
  text: string;
  text_elements?: unknown[];
}

export interface TurnStartParams {
  threadId: string;
  input: UserInput[];
}

export interface TurnInterruptParams {
  threadId: string;
  turnId: string;
}

export interface Turn {
  id: string;
  threadId: string;
  status: "in_progress" | "completed" | "failed" | "cancelled";
  items: ThreadItem[];
}

export interface ReviewStartParams {
  threadId: string;
  path?: string;
  instructions?: string;
}

// --- Thread Items ---

export type ThreadItem =
  | UserMessageItem
  | AgentMessageItem
  | CommandExecutionItem
  | FileChangeItem
  | McpToolCallItem
  | CollabAgentToolCallItem;

export interface UserMessageItem {
  type: "userMessage";
  id: string;
  text: string;
}

export interface AgentMessageItem {
  type: "agentMessage";
  id: string;
  text: string;
}

export interface CommandExecutionItem {
  type: "commandExecution";
  id: string;
  command: string;
  output: string;
  exitCode: number | null;
}

export interface FileChangeItem {
  type: "fileChange";
  id: string;
  path: string;
  diff: string;
}

export interface McpToolCallItem {
  type: "mcpToolCall";
  id: string;
  toolName: string;
  input: unknown;
  output: string;
}

export interface CollabAgentToolCallItem {
  type: "collabAgentToolCall";
  id: string;
  toolName: string;
  input: unknown;
  output: string;
}

// --- Notifications ---

export interface AgentMessageDeltaParams {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface CommandOutputDeltaParams {
  threadId: string;
  turnId: string;
  itemId: string;
  delta: string;
}

export interface ItemCompletedParams {
  threadId: string;
  turnId: string;
  item: ThreadItem;
}

export interface TurnCompletedParams {
  threadId: string;
  turn: Turn;
}

export interface TurnStartedParams {
  threadId: string;
  turnId: string;
}

// --- Server Requests (Codex asking for approval) ---

export interface CommandApprovalRequest {
  threadId: string;
  turnId: string;
  itemId: string;
  command: string;
}

export interface FileChangeApprovalRequest {
  threadId: string;
  turnId: string;
  itemId: string;
  path: string;
  diff: string;
}

export interface ApprovalResponse {
  decision: "accept" | "acceptForSession" | "decline";
}
