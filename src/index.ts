import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AgentBridge } from "./bridge/agent-bridge.js";
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";

async function main() {
  logger.info("Starting AgentBridge MCP Server");

  // WebSocket mode (default): Bridge spawns codex app-server on a WS port,
  // then connects as a client. The user can also connect with:
  //   codex --enable tui_app_server --remote ws://127.0.0.1:<port>
  // to see the conversation in real-time in Codex's native TUI.
  //
  // Set CODEX_TRANSPORT=stdio to use stdio mode instead (no TUI viewing).
  const transport = (process.env.CODEX_TRANSPORT ?? "ws") as "stdio" | "ws";
  const wsPort = process.env.CODEX_WS_PORT ?? "4501";
  const wsUrl = `ws://127.0.0.1:${wsPort}`;

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
