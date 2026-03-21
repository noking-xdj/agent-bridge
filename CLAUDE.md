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
Claude Code ←(MCP/stdio)→ AgentBridge ←(JSON-RPC/stdio)→ Codex app-server
```

Key directories:
- `src/bridge/` - Core: AgentBridge orchestrator, CodexClient, CollaborationManager, MCP server setup
- `src/codex-protocol/` - JSON-RPC framing, Codex process management, protocol types
- `src/sessions/` - Session lifecycle, task tracking, shared context store
- `src/tools/` - MCP tools (delegate, ask, collaborate, exec, review, shared-context)
- `src/utils/` - Config, logger, errors, events

## Codex Protocol Gotchas
- `initialize` requires `clientInfo: { name, version }` not `clientName`/`clientVersion`
- `thread/start` returns `{ thread: { id } }` not `{ id }` directly
- `turn/start` returns `{ turn: { id } }` not `{ id }` directly
- `approvalPolicy` values: `untrusted | on-failure | on-request | granular | never`
- `sandbox` values: `read-only | workspace-write | danger-full-access`
- `initialized` is a notification (no id), not a request
- Codex app-server is experimental — protocol not fully documented

## MCP Configuration
Global: `~/.claude.json` (added via `claude mcp add agent-bridge --scope user`)
Env: `CODEX_PATH` = path to codex binary, `CODEX_MODEL` = model override

## Testing
All tests in `tests/unit/`. Mock Codex client for collaboration tests must include `offNotification`.
