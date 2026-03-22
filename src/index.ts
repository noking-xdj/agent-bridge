import { execSync } from "node:child_process";
import { unlinkSync } from "node:fs";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AgentBridge } from "./bridge/agent-bridge.js";
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";

async function main() {
  logger.info("Starting AgentBridge MCP Server");

  const transport = (process.env.CODEX_TRANSPORT ?? "ws") as "stdio" | "ws";
  const wsPort = process.env.CODEX_WS_PORT ?? "4501";
  const wsUrl = `ws://127.0.0.1:${wsPort}`;

  // Clean up stale state from previous sessions
  if (transport === "ws") {
    try {
      // Kill any leftover codex app-server on this port
      const pids = execSync(`lsof -ti:${wsPort} 2>/dev/null`, { encoding: "utf-8" }).trim();
      if (pids) {
        execSync(`kill ${pids.split("\n").join(" ")} 2>/dev/null`);
        logger.info(`Cleaned up stale processes on port ${wsPort}`);
        // Wait briefly for port to free
        await new Promise((r) => setTimeout(r, 500));
      }
    } catch {
      // No stale processes — good
    }
    // Remove stale thread ID file
    try {
      unlinkSync("/tmp/agent-bridge-thread-id");
    } catch {
      // Didn't exist — fine
    }
  }

  const config = loadConfig({
    codex: {
      binaryPath: process.env.CODEX_PATH ?? "codex",
      transport,
      wsUrl: transport === "ws" ? wsUrl : undefined,
      model: process.env.CODEX_MODEL,
      approvalPolicy: "auto",
      sandbox: "danger-full-access",
    },
  });

  if (transport === "ws") {
    logger.info(`Codex TUI available: codex --enable tui_app_server --remote ${wsUrl}`);
  }

  const bridge = new AgentBridge(config);
  const mcpServer = bridge.getMcpServer();
  const mcpTransport = new StdioServerTransport();

  // Graceful shutdown
  process.on("SIGINT", async () => {
    logger.info("SIGINT received, shutting down");
    await bridge.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received, shutting down");
    await bridge.shutdown();
    process.exit(0);
  });

  await mcpServer.connect(mcpTransport);
  logger.info("AgentBridge MCP Server running on stdio");
}

main().catch((err) => {
  logger.error("Fatal:", err);
  process.exit(1);
});
