import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AgentBridge } from "./bridge/agent-bridge.js";
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";

async function main() {
  logger.info("Starting AgentBridge MCP Server");

  const config = loadConfig({
    codex: {
      binaryPath: process.env.CODEX_PATH ?? "codex",
      transport: "stdio",
      model: process.env.CODEX_MODEL,
      approvalPolicy: "auto",
      sandbox: "danger-full-access",
    },
  });

  const bridge = new AgentBridge(config);
  const mcpServer = bridge.getMcpServer();
  const transport = new StdioServerTransport();

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

  await mcpServer.connect(transport);
  logger.info("AgentBridge MCP Server running on stdio");
}

main().catch((err) => {
  logger.error("Fatal:", err);
  process.exit(1);
});
