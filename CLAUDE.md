# AgentBridge - Claude Code x Codex Collaboration

## Commands
```bash
npm run build    # Compile TypeScript to build/
npm run dev      # Run with tsx (dev mode)
npm start        # Run compiled build
npm test         # Run unit tests (vitest)
npm run test:watch  # Watch mode
```

## Architecture
MCP Server bridging Claude Code (MCP protocol) and Codex CLI (JSON-RPC).
```
Claude Code ←(MCP/stdio)→ AgentBridge ←(WebSocket)→ Codex app-server ←(WebSocket)→ Codex TUI
```

Key directories:
- `src/bridge/` - Core: AgentBridge orchestrator, CodexClient, CollaborationManager, MCP server setup
- `src/codex-protocol/` - JSON-RPC framing, Codex process management, protocol types
- `src/sessions/` - Session lifecycle, task tracking, shared context store
- `src/tools/` - MCP tools (delegate, ask, collaborate, exec, review, shared-context)
- `src/utils/` - Config, logger, errors, events

## Codex Protocol Gotchas
- `initialize` requires `clientInfo: { name, version }` not `clientName`/`clientVersion`
- `initialize` accepts `capabilities.optOutNotificationMethods` — we opt out of `item/commandExecution/outputDelta`
- `turn/completed.turn.items` is empty per v2 spec — all item data comes from `item/completed` notifications
- `thread/start` returns `{ thread: { id } }` not `{ id }` directly
- `turn/start` returns `{ turn: { id } }` not `{ id }` directly
- `approvalPolicy` values: `untrusted | on-failure | on-request | granular | never`
- `sandbox` values: `read-only | workspace-write | danger-full-access`
- `initialized` is a notification (no id), not a request
- Codex app-server is experimental — protocol not fully documented
- WebSocket messages are already framed — no newline delimiter, append `\n` before feeding to `parseBuffer`
- Codex TUI connects via: `codex --enable tui_app_server --remote ws://127.0.0.1:<port>`

## MCP Configuration
Global: `~/.claude.json` (added via `claude mcp add agent-bridge --scope user`)
Env: `CODEX_PATH` = path to codex binary, `CODEX_MODEL` = model override, `CODEX_WS_PORT` = WebSocket port (default 4501)

## Testing
All tests in `tests/unit/` (56 tests). Mock Codex client for collaboration tests must include `offNotification`.

## Output Summarization (protocol-translator.ts)
- `summarizeCommandOutput()`: success → head 6 + tail 2 lines / 600 chars; failure → head 5 + tail 20 lines + error keyword extraction / 2500 chars
- `summarizeMcpOutput()`: JSON → structural summary (keys, array length, error.message); non-JSON → line truncation / 800 chars
- Agent messages and file diffs are always preserved in full
- `truncateByLines()` enforces both line count AND character budget

## MCP Server (mcp-server.ts)
- Uses `registerTool()` / `registerResource()` (modern API, not deprecated `server.tool()`)
- All tools have `ToolAnnotations` (readOnlyHint, destructiveHint, idempotentHint, openWorldHint)
- `wrapHandler()` helper eliminates duplicated try/catch error handling across tools
- Server name: `agent-bridge-mcp-server`

## Key Design Decisions
- Default transport is WebSocket (not stdio) so Codex TUI can connect to the same app-server
- Bridge writes thread ID to `/tmp/agent-bridge-<hash>.json` for `codex-bridge` auto-resume
- Single-flight guards on `initializeCodex()` and `ensureThread()` prevent concurrent races
- Notification buffering prevents message loss when Codex responds before accumulator is registered
- Process exit handler registered only once to prevent accumulation across reconnects
- Failed WebSocket connections clean up the spawned Codex process
- `item/commandExecution/outputDelta` opted out at protocol level — output only from `item/completed`
