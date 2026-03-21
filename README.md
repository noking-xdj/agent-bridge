# AgentBridge

Claude Code and Codex autonomous collaboration through MCP/JSON-RPC protocol bridging.

```
Claude Code ←(MCP/stdio)→ AgentBridge ←(WebSocket)→ Codex app-server ←(WebSocket)→ Codex TUI
```

## Quick Start

### 1. Install

```bash
cd claude_and_codex
npm install
npm run build
```

### 2. Register MCP Server

```bash
claude mcp add agent-bridge --scope user \
  -e CODEX_PATH=$(which codex) \
  -e CODEX_WS_PORT=4501 \
  -- node "$(pwd)/build/index.js"
```

### 3. Use

**Left terminal** — start Claude Code:
```bash
claude
```

**Right terminal** — watch the collaboration in real-time:
```bash
codex-bridge
```

Then in Claude Code, use any bridge tool:
```
Ask Codex what it thinks about this codebase
```

## Features

### MCP Tools

| Tool | Description |
|------|-------------|
| `codex_delegate` | Delegate a task to Codex (write code, run commands, etc.) |
| `codex_ask` | Ask Codex a question and get a response |
| `codex_collaborate` | Bidirectional collaboration — both agents take turns |
| `codex_exec` | Have Codex execute a shell command |
| `codex_review` | Have Codex perform a code review |
| `codex_status` | Check status of delegated tasks |
| `shared_context_write` | Write to shared context store |
| `shared_context_read` | Read from shared context store |
| `shared_context_delete` | Delete from shared context store |

### Collaboration Modes

**One-directional**: Claude delegates tasks to Codex via `codex_delegate`, `codex_ask`, `codex_exec`, `codex_review`. Claude is the orchestrator, Codex executes.

**Bidirectional**: `codex_collaborate` starts a multi-turn conversation where both agents take turns contributing toward a shared goal. Uses MCP Sampling to let Codex "talk back" to Claude.

### Real-time TUI Viewing

The `codex-bridge` command connects Codex's native interactive TUI to the same app-server that the Bridge uses. Both terminals show the conversation in real-time:

- Claude Code (left) sees Codex's responses as tool results
- Codex TUI (right) shows the full conversation with streaming output

### Shared Context

A key-value store that persists across tool calls within a session. Claude writes context (e.g., project requirements, tech stack decisions), and it's automatically included when delegating tasks to Codex.

### Session & Task Management

- Automatic session lifecycle with lazy Codex initialization
- Task tracking with status (pending → running → completed/failed)
- Single-flight guards prevent concurrent initialization races
- Notification buffering prevents message loss during turn startup
- Automatic reconnection after Codex process crashes

## Architecture

```
src/
├── index.ts                    # Entry point — MCP Server on stdio
├── bridge/
│   ├── agent-bridge.ts         # Main orchestrator
│   ├── codex-client.ts         # JSON-RPC client (stdio + WebSocket)
│   ├── collaboration.ts        # Bidirectional collaboration manager
│   ├── mcp-server.ts           # MCP tool/resource registration
│   └── protocol-translator.ts  # Turn accumulator + protocol translation
├── codex-protocol/
│   ├── types.ts                # Codex JSON-RPC protocol types
│   ├── json-rpc.ts             # Message framing and parsing
│   └── process-manager.ts      # Codex process lifecycle
├── sessions/
│   ├── session.ts              # Session + task state
│   ├── session-manager.ts      # Session lifecycle
│   └── context-store.ts        # Shared context key-value store
├── tools/                      # MCP tool implementations
└── utils/                      # Config, logger, errors, events
```

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CODEX_PATH` | `codex` | Path to Codex binary |
| `CODEX_WS_PORT` | `4501` | WebSocket port for app-server |
| `CODEX_MODEL` | *(default)* | Model override for Codex |
| `CODEX_TRANSPORT` | `ws` | Transport mode: `ws` or `stdio` |

## Development

```bash
npm run build       # Compile TypeScript
npm run dev         # Run with tsx (dev mode)
npm test            # Run unit tests
npm run test:watch  # Watch mode
```
