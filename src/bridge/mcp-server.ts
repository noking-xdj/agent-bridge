import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { AgentBridge } from "./agent-bridge.js";
import {
  codexDelegateSchema,
  codexDelegateDescription,
  handleCodexDelegate,
} from "../tools/codex-delegate.js";
import {
  codexAskSchema,
  codexAskDescription,
  handleCodexAsk,
} from "../tools/codex-ask.js";
import {
  codexStatusSchema,
  codexStatusDescription,
  handleCodexStatus,
} from "../tools/codex-status.js";
import {
  codexExecSchema,
  codexExecDescription,
  handleCodexExec,
} from "../tools/codex-exec.js";
import {
  codexReviewSchema,
  codexReviewDescription,
  handleCodexReview,
} from "../tools/codex-review.js";
import {
  codexCollaborateSchema,
  codexCollaborateDescription,
  handleCodexCollaborate,
} from "../tools/codex-collaborate.js";
import {
  sharedContextWriteSchema,
  sharedContextWriteDescription,
  handleSharedContextWrite,
  sharedContextReadSchema,
  sharedContextReadDescription,
  handleSharedContextRead,
  sharedContextDeleteSchema,
  sharedContextDeleteDescription,
  handleSharedContextDelete,
} from "../tools/shared-context.js";
import { logger } from "../utils/logger.js";
import type { ToolAnnotations } from "@modelcontextprotocol/sdk/types.js";

/**
 * Wraps a tool handler with standard error handling.
 * Eliminates duplicated try/catch across all tool registrations.
 */
function wrapHandler<TArgs>(
  name: string,
  handler: (bridge: AgentBridge, args: TArgs) => Promise<string>,
  bridge: AgentBridge,
) {
  return async (args: TArgs) => {
    try {
      const result = await handler(bridge, args);
      return { content: [{ type: "text" as const, text: result }] };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error(`${name} error:`, msg);
      return {
        content: [{ type: "text" as const, text: `Error: ${msg}` }],
        isError: true,
      };
    }
  };
}

export function createMcpServer(bridge: AgentBridge): McpServer {
  const server = new McpServer({
    name: "agent-bridge-mcp-server",
    version: "0.1.0",
  });

  // --- Codex tools ---

  server.registerTool(
    "codex_delegate",
    {
      title: "Delegate Task to Codex",
      description: codexDelegateDescription(),
      inputSchema: codexDelegateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      } satisfies ToolAnnotations,
    },
    wrapHandler("codex_delegate", handleCodexDelegate, bridge),
  );

  server.registerTool(
    "codex_ask",
    {
      title: "Ask Codex a Question",
      description: codexAskDescription(),
      inputSchema: codexAskSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      } satisfies ToolAnnotations,
    },
    wrapHandler("codex_ask", handleCodexAsk, bridge),
  );

  server.registerTool(
    "codex_status",
    {
      title: "Check Task Status",
      description: codexStatusDescription(),
      inputSchema: codexStatusSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      } satisfies ToolAnnotations,
    },
    wrapHandler("codex_status", handleCodexStatus, bridge),
  );

  server.registerTool(
    "codex_exec",
    {
      title: "Execute Command via Codex",
      description: codexExecDescription(),
      inputSchema: codexExecSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      } satisfies ToolAnnotations,
    },
    wrapHandler("codex_exec", handleCodexExec, bridge),
  );

  server.registerTool(
    "codex_review",
    {
      title: "Code Review via Codex",
      description: codexReviewDescription(),
      inputSchema: codexReviewSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: false,
        openWorldHint: true,
      } satisfies ToolAnnotations,
    },
    wrapHandler("codex_review", handleCodexReview, bridge),
  );

  server.registerTool(
    "codex_collaborate",
    {
      title: "Claude-Codex Collaboration",
      description: codexCollaborateDescription(),
      inputSchema: codexCollaborateSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: false,
        openWorldHint: true,
      } satisfies ToolAnnotations,
    },
    wrapHandler("codex_collaborate", handleCodexCollaborate, bridge),
  );

  // --- Shared context tools ---

  server.registerTool(
    "shared_context_write",
    {
      title: "Write Shared Context",
      description: sharedContextWriteDescription(),
      inputSchema: sharedContextWriteSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      } satisfies ToolAnnotations,
    },
    wrapHandler("shared_context_write", handleSharedContextWrite, bridge),
  );

  server.registerTool(
    "shared_context_read",
    {
      title: "Read Shared Context",
      description: sharedContextReadDescription(),
      inputSchema: sharedContextReadSchema,
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      } satisfies ToolAnnotations,
    },
    wrapHandler("shared_context_read", handleSharedContextRead, bridge),
  );

  server.registerTool(
    "shared_context_delete",
    {
      title: "Delete Shared Context",
      description: sharedContextDeleteDescription(),
      inputSchema: sharedContextDeleteSchema,
      annotations: {
        readOnlyHint: false,
        destructiveHint: true,
        idempotentHint: true,
        openWorldHint: false,
      } satisfies ToolAnnotations,
    },
    wrapHandler("shared_context_delete", handleSharedContextDelete, bridge),
  );

  // --- Resources ---

  server.registerResource(
    "session-info",
    "bridge://session",
    {
      description: "Current AgentBridge session information including thread ID, status, and task count",
      mimeType: "application/json",
    },
    async () => {
      const session = bridge.sessionManager.getActiveSession();
      const text = session
        ? JSON.stringify(session.toSummary(), null, 2)
        : JSON.stringify({ status: "no_active_session" });
      return { contents: [{ uri: "bridge://session", text }] };
    },
  );

  server.registerResource(
    "task-list",
    "bridge://tasks",
    {
      description: "List of all delegated tasks and their statuses (id, description, status, completedAt)",
      mimeType: "application/json",
    },
    async () => {
      const session = bridge.sessionManager.getActiveSession();
      if (!session) {
        return {
          contents: [{ uri: "bridge://tasks", text: JSON.stringify([]) }],
        };
      }
      const tasks = Array.from(session.tasks.values()).map((t) => ({
        id: t.id,
        description: t.description,
        status: t.status,
        completedAt: t.completedAt
          ? new Date(t.completedAt).toISOString()
          : null,
      }));
      return {
        contents: [
          { uri: "bridge://tasks", text: JSON.stringify(tasks, null, 2) },
        ],
      };
    },
  );

  return server;
}
