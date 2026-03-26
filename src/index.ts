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
    // Only kill the specific PID recorded by the previous bridge instance,
    // not whatever happens to be on the port (could be an unrelated service)
    if (data.pid) {
      try {
        // Verify it's actually a codex app-server for this project before killing
        const cmdline = execSync(`ps -p ${data.pid} -o command= 2>/dev/null`, {
          encoding: "utf-8",
        }).trim();
        if (cmdline.includes("codex") && cmdline.includes("app-server")) {
          execSync(`kill ${data.pid} 2>/dev/null`);
          logger.info(`Cleaned up stale codex app-server (pid: ${data.pid})`);
        }
      } catch {
        // Process already gone
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

    // NOTE: state file is NOT written here — it is deferred until after
    // warmup so that codex-bridge cannot discover (and connect to) the
    // app-server before the session JSONL file exists.

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

  // Track codex child PID and thread ID — state file is written once warmup
  // completes (or on first tool call in stdio mode) so that codex-bridge
  // cannot discover the app-server before the session JSONL exists.
  let codexChildPid = 0;
  let stateFileWritten = false;

  bridge.onCodexStarted = (pid: number) => {
    codexChildPid = pid;
    logger.info(`Codex started with pid ${pid}`);
  };

  bridge.onThreadCreated = (threadId: string) => {
    // In WS mode the state file is written after warmup; this callback
    // handles subsequent thread creations (e.g. after a process restart).
    if (wsPort && stateFileWritten) {
      writeState(hash, { port: wsPort, cwd, threadId, pid: codexChildPid });
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

  // In WebSocket mode, eagerly warm up Codex so the session JSONL file
  // exists before the TUI connects.  The Codex app-server only creates the
  // JSONL on the first turn/start (not thread/start), so without this the
  // TUI receives a session notification and fails to resume from a
  // non-existent file.
  //
  // The state file is written AFTER warmup so that codex-bridge cannot
  // discover the app-server until the JSONL is ready.
  if (codexTransport === "ws" && wsPort) {
    try {
      await bridge.warmup({ cwd });
    } catch (err) {
      logger.warn("Warmup failed (non-fatal):", err);
    }
    // Now that the session JSONL exists, publish the state file so
    // codex-bridge can discover and connect safely.
    const session = bridge.sessionManager.getActiveSession();
    writeState(hash, {
      port: wsPort,
      cwd,
      threadId: session?.codexThreadId ?? undefined,
      pid: codexChildPid,
    });
    stateFileWritten = true;
    logger.info("State file published — codex-bridge can now connect");
  }
}

main().catch((err) => {
  logger.error("Fatal:", err);
  process.exit(1);
});
