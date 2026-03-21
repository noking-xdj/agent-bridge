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

export function createMcpServer(bridge: AgentBridge): McpServer {
  const server = new McpServer({
    name: "AgentBridge",
    version: "0.1.0",
  });

  // Register tools
  server.tool(
    "codex_delegate",
    codexDelegateDescription(),
    codexDelegateSchema,
    async (args) => {
      try {
        const result = await handleCodexDelegate(bridge, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("codex_delegate error:", msg);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "codex_ask",
    codexAskDescription(),
    codexAskSchema,
    async (args) => {
      try {
        const result = await handleCodexAsk(bridge, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "codex_status",
    codexStatusDescription(),
    codexStatusSchema,
    async (args) => {
      try {
        const result = await handleCodexStatus(bridge, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "codex_exec",
    codexExecDescription(),
    codexExecSchema,
    async (args) => {
      try {
        const result = await handleCodexExec(bridge, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "codex_review",
    codexReviewDescription(),
    codexReviewSchema,
    async (args) => {
      try {
        const result = await handleCodexReview(bridge, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "codex_collaborate",
    codexCollaborateDescription(),
    codexCollaborateSchema,
    async (args) => {
      try {
        const result = await handleCodexCollaborate(bridge, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        logger.error("codex_collaborate error:", msg);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "shared_context_write",
    sharedContextWriteDescription(),
    sharedContextWriteSchema,
    async (args) => {
      try {
        const result = await handleSharedContextWrite(bridge, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "shared_context_read",
    sharedContextReadDescription(),
    sharedContextReadSchema,
    async (args) => {
      try {
        const result = await handleSharedContextRead(bridge, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  server.tool(
    "shared_context_delete",
    sharedContextDeleteDescription(),
    sharedContextDeleteSchema,
    async (args) => {
      try {
        const result = await handleSharedContextDelete(bridge, args);
        return { content: [{ type: "text" as const, text: result }] };
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        return {
          content: [{ type: "text" as const, text: `Error: ${msg}` }],
          isError: true,
        };
      }
    },
  );

  // Register resources
  server.resource(
    "session-info",
    "bridge://session",
    { description: "Current AgentBridge session information" },
    async () => {
      const session = bridge.sessionManager.getActiveSession();
      const text = session
        ? JSON.stringify(session.toSummary(), null, 2)
        : "No active session";
      return { contents: [{ uri: "bridge://session", text }] };
    },
  );

  server.resource(
    "task-list",
    "bridge://tasks",
    { description: "List of all delegated tasks and their statuses" },
    async () => {
      const session = bridge.sessionManager.getActiveSession();
      if (!session) {
        return {
          contents: [{ uri: "bridge://tasks", text: "No active session" }],
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
