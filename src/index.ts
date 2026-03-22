import { createHash } from "node:crypto";
import { execSync } from "node:child_process";
import {
  unlinkSync,
  writeFileSync,
  readFileSync,
  readdirSync,
} from "node:fs";
import { createServer } from "node:net";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { AgentBridge } from "./bridge/agent-bridge.js";
import { loadConfig } from "./utils/config.js";
import { logger } from "./utils/logger.js";

/** Derive a short hash from the cwd to uniquely identify this project. */
function cwdHash(cwd: string): string {
  return createHash("sha256").update(cwd).digest("hex").substring(0, 8);
}

/** State file path for a given project hash. */
function stateFilePath(hash: string): string {
  return `/tmp/agent-bridge-${hash}.json`;
}

/** Find a free port by binding to port 0. */
async function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      if (addr && typeof addr === "object") {
        const port = addr.port;
        server.close(() => resolve(port));
      } else {
        server.close(() => reject(new Error("Failed to get port")));
      }
    });
    server.on("error", reject);
  });
}

/** Clean up stale state file and processes for this project. */
function cleanupStale(hash: string): void {
  const filePath = stateFilePath(hash);
  try {
    const data = JSON.parse(readFileSync(filePath, "utf-8"));
    if (data.port) {
      try {
        const pids = execSync(`lsof -ti:${data.port} 2>/dev/null`, {
          encoding: "utf-8",
        }).trim();
        if (pids) {
          execSync(`kill ${pids.split("\n").join(" ")} 2>/dev/null`);
          logger.info(
            `Cleaned up stale processes on port ${data.port}`,
          );
        }
      } catch {
        // No processes
      }
    }
    unlinkSync(filePath);
  } catch {
    // No stale state
  }
}

/** Write state file so codex-bridge can discover this instance. */
function writeState(
  hash: string,
  data: { port: number; cwd: string; threadId?: string; pid: number },
): void {
  writeFileSync(stateFilePath(hash), JSON.stringify(data, null, 2));
}

async function main() {
  logger.info("Starting AgentBridge MCP Server");

  const codexTransport = (process.env.CODEX_TRANSPORT ?? "ws") as
    | "stdio"
    | "ws";
  const cwd = process.cwd();
  const hash = cwdHash(cwd);

  let wsPort: number | undefined;
  let wsUrl: string | undefined;

  if (codexTransport === "ws") {
    // Clean up any stale instance for this project
    cleanupStale(hash);

    // Find a free port
    wsPort = process.env.CODEX_WS_PORT
      ? parseInt(process.env.CODEX_WS_PORT, 10)
      : await findFreePort();
    wsUrl = `ws://127.0.0.1:${wsPort}`;

    // Write initial state (threadId will be updated later)
    writeState(hash, { port: wsPort, cwd, pid: process.pid });

    // Brief wait for port cleanup
    await new Promise((r) => setTimeout(r, 300));
  }

  const config = loadConfig({
    codex: {
      binaryPath: process.env.CODEX_PATH ?? "codex",
      transport: codexTransport,
      wsUrl,
      model: process.env.CODEX_MODEL,
      approvalPolicy: "auto",
      sandbox: "danger-full-access",
    },
  });

  if (codexTransport === "ws") {
    logger.info(
      `Codex TUI: codex-bridge (auto) or codex --enable tui_app_server --remote ${wsUrl}`,
    );
  }

  const bridge = new AgentBridge(config);

  // Override the thread ID writer to update the state file
  bridge.onThreadCreated = (threadId: string) => {
    if (wsPort) {
      writeState(hash, { port: wsPort, cwd, threadId, pid: process.pid });
      logger.info(`State updated with thread ${threadId}`);
    }
  };

  const mcpServer = bridge.getMcpServer();
  const mcpTransport = new StdioServerTransport();

  const cleanup = () => {
    try {
      unlinkSync(stateFilePath(hash));
    } catch {
      // Best effort
    }
  };

  process.on("SIGINT", async () => {
    logger.info("SIGINT received, shutting down");
    cleanup();
    await bridge.shutdown();
    process.exit(0);
  });

  process.on("SIGTERM", async () => {
    logger.info("SIGTERM received, shutting down");
    cleanup();
    await bridge.shutdown();
    process.exit(0);
  });

  process.on("exit", cleanup);

  await mcpServer.connect(mcpTransport);
  logger.info("AgentBridge MCP Server running on stdio");
}

main().catch((err) => {
  logger.error("Fatal:", err);
  process.exit(1);
});
