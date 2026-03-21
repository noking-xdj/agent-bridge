/**
 * Codex Conversation Viewer
 *
 * A proxy that sits between the AgentBridge and Codex app-server,
 * displaying the conversation in real-time in the terminal.
 *
 * Usage:
 *   npx tsx src/viewer.ts [port]
 *
 * Default port: 9876
 */

import { spawn, type ChildProcess } from "node:child_process";
import { WebSocketServer, WebSocket } from "ws";

const PORT = parseInt(process.argv[2] ?? "9876", 10);
const CODEX_PATH = process.env.CODEX_PATH ?? "codex";

// --- Terminal colors ---
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const CYAN = "\x1b[36m";
const GREEN = "\x1b[32m";
const YELLOW = "\x1b[33m";
const MAGENTA = "\x1b[35m";
const BLUE = "\x1b[34m";
const RED = "\x1b[31m";
const WHITE = "\x1b[37m";
const BG_BLUE = "\x1b[44m";
const BG_GREEN = "\x1b[42m";

function log(msg: string) {
  console.log(msg);
}

function separator(label: string, color: string) {
  const line = "─".repeat(Math.max(0, 60 - label.length - 4));
  log(`\n${color}${BOLD}── ${label} ${line}${RESET}`);
}

function printBanner() {
  log(`${BOLD}${CYAN}`);
  log(`╔══════════════════════════════════════════════════════════════╗`);
  log(`║           AgentBridge Conversation Viewer                   ║`);
  log(`║       Claude Code  ←→  Codex  Real-time Monitor            ║`);
  log(`╚══════════════════════════════════════════════════════════════╝${RESET}`);
  log(``);
  log(`${DIM}WebSocket server: ws://127.0.0.1:${PORT}${RESET}`);
  log(`${DIM}Waiting for AgentBridge to connect...${RESET}`);
  log(``);
}

// --- Start Codex app-server as child process (stdio) ---
let codexProcess: ChildProcess;
let codexBuffer = "";

function startCodex(): ChildProcess {
  const proc = spawn(CODEX_PATH, ["app-server", "--listen", "stdio://"], {
    stdio: ["pipe", "pipe", "pipe"],
    env: { ...process.env },
  });

  proc.stderr?.on("data", (data: Buffer) => {
    const msg = data.toString().trim();
    if (msg) log(`${DIM}[codex stderr] ${msg}${RESET}`);
  });

  proc.on("exit", (code) => {
    log(`${RED}${BOLD}Codex process exited (code: ${code})${RESET}`);
    process.exit(1);
  });

  proc.on("error", (err) => {
    log(`${RED}Codex process error: ${err.message}${RESET}`);
    process.exit(1);
  });

  return proc;
}

// --- Parse and display messages ---

function displayClientMessage(msg: any) {
  if (!msg.method) return;

  switch (msg.method) {
    case "initialize":
      separator("INITIALIZE", BLUE);
      log(`${BLUE}Client: ${msg.params?.clientInfo?.name ?? "unknown"} v${msg.params?.clientInfo?.version ?? "?"}${RESET}`);
      break;

    case "initialized":
      log(`${DIM}[initialized notification sent]${RESET}`);
      break;

    case "thread/start":
      separator("NEW THREAD", MAGENTA);
      log(`${MAGENTA}CWD: ${msg.params?.cwd ?? "?"}${RESET}`);
      log(`${MAGENTA}Policy: ${msg.params?.approvalPolicy ?? "?"} | Sandbox: ${msg.params?.sandbox ?? "?"}${RESET}`);
      break;

    case "turn/start": {
      separator("CLAUDE → CODEX", CYAN);
      const inputs = msg.params?.input ?? [];
      for (const input of inputs) {
        if (input.type === "text") {
          log(`${WHITE}${input.text}${RESET}`);
        }
      }
      break;
    }

    case "turn/interrupt":
      log(`${YELLOW}${BOLD}[Turn interrupted]${RESET}`);
      break;

    default:
      log(`${DIM}→ ${msg.method}${RESET}`);
  }
}

function displayServerMessage(msg: any) {
  // Response to a request
  if (msg.id !== undefined && msg.result !== undefined) {
    if (msg.result?.userAgent) {
      log(`${GREEN}Codex: ${msg.result.userAgent}${RESET}`);
    } else if (msg.result?.thread?.id) {
      log(`${MAGENTA}Thread ID: ${msg.result.thread.id}${RESET}`);
    } else if (msg.result?.turn?.id) {
      log(`${DIM}Turn started: ${msg.result.turn.id}${RESET}`);
    }
    return;
  }

  if (msg.error) {
    log(`${RED}${BOLD}ERROR [${msg.error.code}]: ${msg.error.message}${RESET}`);
    return;
  }

  // Notifications from Codex
  const method = msg.method;
  if (!method) return;

  switch (method) {
    case "item/agentMessage/delta":
      process.stdout.write(`${GREEN}${msg.params?.delta ?? ""}${RESET}`);
      break;

    case "item/completed": {
      const item = msg.params?.item;
      if (!item) break;
      if (item.type === "agentMessage") {
        // Final agent message — print newline if we were streaming deltas
        log("");
      } else if (item.type === "commandExecution") {
        separator("COMMAND", YELLOW);
        log(`${YELLOW}$ ${item.command}${RESET}`);
        if (item.output) {
          log(`${DIM}${item.output}${RESET}`);
        }
        log(`${DIM}Exit code: ${item.exitCode}${RESET}`);
      } else if (item.type === "fileChange") {
        separator("FILE CHANGE", MAGENTA);
        log(`${MAGENTA}${item.path}${RESET}`);
        if (item.diff) {
          log(`${DIM}${item.diff}${RESET}`);
        }
      }
      break;
    }

    case "turn/started":
      separator("CODEX → CLAUDE", GREEN);
      break;

    case "turn/completed": {
      const status = msg.params?.turn?.status ?? "unknown";
      const color = status === "completed" ? GREEN : RED;
      log(`\n${color}${BOLD}[Turn ${status}]${RESET}`);
      break;
    }

    case "item/commandExecution/outputDelta":
      process.stdout.write(`${DIM}${msg.params?.delta ?? ""}${RESET}`);
      break;

    case "item/started": {
      const item = msg.params?.item;
      if (item?.type === "agentMessage") {
        // About to stream agent response
      } else if (item?.type === "commandExecution") {
        log(`${YELLOW}${BOLD}[Executing command...]${RESET}`);
      }
      break;
    }

    // Ignore noisy notifications
    case "thread/started":
    case "thread/status/changed":
    case "thread/tokenUsage/updated":
    case "account/rateLimits/updated":
      break;

    default:
      log(`${DIM}← ${method}${RESET}`);
  }
}

// --- WebSocket server (Bridge connects here) ---
const wss = new WebSocketServer({ port: PORT });

wss.on("listening", () => {
  log(`${GREEN}${BOLD}WebSocket server listening on ws://127.0.0.1:${PORT}${RESET}\n`);
});

wss.on("connection", (ws: WebSocket) => {
  log(`${GREEN}${BOLD}AgentBridge connected!${RESET}\n`);

  // Start Codex process on first connection
  if (!codexProcess) {
    codexProcess = startCodex();

    // Forward Codex stdout → parse → display + forward to Bridge
    codexProcess.stdout!.on("data", (data: Buffer) => {
      codexBuffer += data.toString();
      const lines = codexBuffer.split("\n");
      codexBuffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const msg = JSON.parse(trimmed);
          displayServerMessage(msg);
          // Forward to Bridge
          if (ws.readyState === WebSocket.OPEN) {
            ws.send(trimmed);
          }
        } catch {
          // skip
        }
      }
    });
  }

  // Bridge → parse → display + forward to Codex
  ws.on("message", (data: Buffer | string) => {
    const str = data.toString();
    const lines = str.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const msg = JSON.parse(trimmed);
        displayClientMessage(msg);
        // Forward to Codex
        codexProcess.stdin!.write(trimmed + "\n");
      } catch {
        // skip
      }
    }
  });

  ws.on("close", () => {
    log(`\n${YELLOW}AgentBridge disconnected${RESET}`);
  });

  ws.on("error", (err) => {
    log(`${RED}WebSocket error: ${err.message}${RESET}`);
  });
});

// --- Main ---
printBanner();

process.on("SIGINT", () => {
  log(`\n${DIM}Shutting down...${RESET}`);
  codexProcess?.kill();
  wss.close();
  process.exit(0);
});

process.on("SIGTERM", () => {
  codexProcess?.kill();
  wss.close();
  process.exit(0);
});
