# AgentBridge

Claude Code and Codex autonomous collaboration through MCP/JSON-RPC protocol bridging.

```
Claude Code ←(MCP/stdio)→ AgentBridge ←(WebSocket)→ Codex app-server ←(WebSocket)→ Codex TUI
```

## Prerequisites

| Dependency | Version | Install |
|-----------|---------|---------|
| **Node.js** | >= 18 | [nodejs.org](https://nodejs.org/) |
| **Claude Code** | latest | `npm install -g @anthropic-ai/claude-code` |
| **Codex CLI** | latest | `npm install -g @openai/codex` |

You also need valid API keys configured:
- **Anthropic API key** for Claude Code (`ANTHROPIC_API_KEY`)
- **OpenAI API key** for Codex (`OPENAI_API_KEY`)

## Quick Start

### 1. Install

```bash
git clone <repo-url> && cd claude_and_codex
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

All tools use the modern `registerTool()` API with [Tool Annotations](#tool-annotations) for accurate safety/planning hints.

| Tool | Description | Annotations |
|------|-------------|-------------|
| `codex_delegate` | Delegate a task to Codex (write code, run commands, etc.) | destructive, open-world |
| `codex_ask` | Ask Codex a question and get a response | open-world |
| `codex_collaborate` | Bidirectional collaboration — both agents take turns | destructive, open-world |
| `codex_exec` | Have Codex execute a shell command | destructive, open-world |
| `codex_review` | Have Codex perform a code review | open-world |
| `codex_status` | Check status of delegated tasks | read-only, idempotent |
| `shared_context_write` | Write to shared context store | destructive (overwrites), idempotent |
| `shared_context_read` | Read from shared context store | read-only, idempotent |
| `shared_context_delete` | Delete from shared context store | destructive, idempotent |

### Tool Annotations

Each tool declares `readOnlyHint`, `destructiveHint`, `idempotentHint`, and `openWorldHint` to help MCP clients make informed planning and safety decisions. All Codex-backed tools are marked `openWorldHint: true` since they execute real Codex turns with full sandbox access.

### Collaboration Modes

**One-directional**: Claude delegates tasks to Codex via `codex_delegate`, `codex_ask`, `codex_exec`, `codex_review`. Claude is the orchestrator, Codex executes.

**Bidirectional**: `codex_collaborate` starts a multi-turn conversation where both agents take turns contributing toward a shared goal. Uses MCP Sampling to let Codex "talk back" to Claude.

### Smart Output Summarization

Codex responses are intelligently summarized to avoid bloating Claude Code's context window:

| Content Type | Strategy | Budget |
|-------------|----------|--------|
| Agent message | Full text preserved | Unlimited |
| File changes (diff) | Full diff preserved | Unlimited |
| Successful commands | Head 6 + tail 2 lines | 600 chars |
| Failed commands | Head 5 + tail 20 lines + error keyword extraction | 2,500 chars |
| MCP tool output (JSON) | Structural summary (top-level keys, array length, error.message) | 800 chars |
| MCP tool output (text) | Head 8 + tail 4 lines | 800 chars |

This reduces typical return payloads from ~70K chars (raw shell output + API JSON) down to ~2-3K of actionable content.

**Protocol-level optimization**: The bridge opts out of `item/commandExecution/outputDelta` via `initialize.capabilities.optOutNotificationMethods`, preventing unnecessary streaming command output from ever being transmitted.

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
│   ├── mcp-server.ts           # MCP tool/resource registration (registerTool API)
│   └── protocol-translator.ts  # Turn accumulator + smart output summarization
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

## Codex Protocol Integration

### Key Protocol Details

- `initialize` sends `capabilities.optOutNotificationMethods` to disable `item/commandExecution/outputDelta`
- Output data comes from `item/completed` notifications (`commandExecution.aggregatedOutput`)
- `turn/completed.turn.items` is empty per Codex v2 protocol spec — all item data arrives via `item/completed`
- `initialized` is a notification (no id), not a request
- WebSocket messages are already framed — append `\n` before feeding to `parseBuffer`

### Approval & Sandbox

- `approvalPolicy`: `untrusted | on-failure | on-request | granular | never`
- `sandbox`: `read-only | workspace-write | danger-full-access`

## Configuration

| Environment Variable | Default | Description |
|---------------------|---------|-------------|
| `CODEX_PATH` | `codex` | Path to Codex binary |
| `CODEX_WS_PORT` | *(auto)* | WebSocket port for app-server (auto-assigned if not set) |
| `CODEX_MODEL` | *(default)* | Model override for Codex |
| `CODEX_TRANSPORT` | `ws` | Transport mode: `ws` or `stdio` |

## Development

```bash
npm run build       # Compile TypeScript
npm run dev         # Run with tsx (dev mode)
npm test            # Run unit tests (56 tests)
npm run test:watch  # Watch mode
```

## MCP Resources

| URI | Description |
|-----|-------------|
| `bridge://session` | Current session info (JSON) |
| `bridge://tasks` | Task list with statuses (JSON) |
