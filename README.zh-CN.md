# AgentBridge

通过 MCP/JSON-RPC 协议桥接，实现 Claude Code 与 Codex 的自主协作。

```
Claude Code ←(MCP/stdio)→ AgentBridge ←(WebSocket)→ Codex app-server ←(WebSocket)→ Codex TUI
```

## 前置条件

| 依赖 | 版本 | 安装方式 |
|------|------|---------|
| **Node.js** | >= 18 | [nodejs.org](https://nodejs.org/) |
| **Claude Code** | latest | `npm install -g @anthropic-ai/claude-code` |
| **Codex CLI** | latest | `npm install -g @openai/codex` |

还需要配置 API Key：
- **Anthropic API Key**（Claude Code 使用）：`ANTHROPIC_API_KEY`
- **OpenAI API Key**（Codex 使用）：`OPENAI_API_KEY`

## 快速开始

### 1. 安装

```bash
git clone <repo-url> && cd claude_and_codex
npm install
npm run build
```

### 2. 注册 MCP Server

```bash
claude mcp add agent-bridge --scope user \
  -e CODEX_PATH=$(which codex) \
  -e CODEX_WS_PORT=4501 \
  -- node "$(pwd)/build/index.js"
```

### 3. 使用

**左侧终端** — 启动 Claude Code：
```bash
claude
```

**右侧终端** — 实时查看协作过程：
```bash
codex-bridge
```

然后在 Claude Code 中使用任意桥接工具：
```
让 Codex 看看这个代码库有什么问题
```

## 功能特性

### MCP 工具

所有工具使用现代 `registerTool()` API 注册，并附带[工具注解](#工具注解)以提供准确的安全/规划提示。

| 工具 | 说明 | 注解 |
|------|------|------|
| `codex_delegate` | 委托任务给 Codex（写代码、执行命令等） | 破坏性、开放世界 |
| `codex_ask` | 向 Codex 提问并获取回答 | 开放世界 |
| `codex_collaborate` | 双向协作 — 两个 Agent 轮流贡献 | 破坏性、开放世界 |
| `codex_exec` | 让 Codex 执行 shell 命令 | 破坏性、开放世界 |
| `codex_review` | 让 Codex 进行代码审查 | 开放世界 |
| `codex_status` | 查看委托任务的状态 | 只读、幂等 |
| `shared_context_write` | 写入共享上下文存储 | 破坏性（覆盖）、幂等 |
| `shared_context_read` | 读取共享上下文存储 | 只读、幂等 |
| `shared_context_delete` | 删除共享上下文条目 | 破坏性、幂等 |

### 工具注解

每个工具都声明了 `readOnlyHint`、`destructiveHint`、`idempotentHint` 和 `openWorldHint`，帮助 MCP 客户端做出合理的规划和安全决策。所有 Codex 相关工具都标记为 `openWorldHint: true`，因为它们会执行真实的 Codex 会话，具有完整的沙箱访问权限。

### 协作模式

**单向协作**：Claude 通过 `codex_delegate`、`codex_ask`、`codex_exec`、`codex_review` 将任务委托给 Codex。Claude 是编排者，Codex 负责执行。

**双向协作**：`codex_collaborate` 发起多轮对话，两个 Agent 轮流为共同目标做贡献。通过 MCP Sampling 实现 Codex "反向对话" Claude。

### 智能输出摘要

Codex 的返回内容会被智能摘要，避免撑爆 Claude Code 的上下文窗口：

| 内容类型 | 策略 | 预算 |
|---------|------|------|
| Agent 文本回复 | 完整保留 | 无限制 |
| 文件变更（diff） | 完整保留 | 无限制 |
| 成功命令 | 保留头 6 行 + 尾 2 行 | 600 字符 |
| 失败命令 | 保留头 5 行 + 尾 20 行 + 错误关键词提取 | 2,500 字符 |
| MCP 工具输出（JSON） | 结构化摘要（顶层 key、数组长度、error.message） | 800 字符 |
| MCP 工具输出（文本） | 保留头 8 行 + 尾 4 行 | 800 字符 |

这将典型的返回载荷从约 70K 字符（原始 shell 输出 + API JSON）压缩到约 2-3K 的可操作内容。

**协议层优化**：Bridge 在初始化时通过 `initialize.capabilities.optOutNotificationMethods` 关闭 `item/commandExecution/outputDelta`，从源头阻止不必要的流式命令输出传输。

### 实时 TUI 查看

`codex-bridge` 命令将 Codex 的原生交互式 TUI 连接到 Bridge 使用的同一个 app-server。两个终端实时显示对话过程：

- Claude Code（左侧）以工具结果形式看到 Codex 的回复
- Codex TUI（右侧）显示完整对话和流式输出

### 共享上下文

一个在会话内跨工具调用持久化的键值存储。Claude 写入上下文（如项目需求、技术栈决策），这些内容会在委托任务给 Codex 时自动附带。

### 会话与任务管理

- 自动会话生命周期管理，Codex 延迟初始化
- 任务状态跟踪（pending → running → completed/failed）
- 单次飞行守卫（Single-flight guard）防止并发初始化竞争
- 通知缓冲机制防止 turn 启动期间消息丢失
- Codex 进程崩溃后自动重连

## 项目结构

```
src/
├── index.ts                    # 入口 — stdio 上的 MCP Server
├── bridge/
│   ├── agent-bridge.ts         # 主编排器
│   ├── codex-client.ts         # JSON-RPC 客户端（stdio + WebSocket）
│   ├── collaboration.ts        # 双向协作管理器
│   ├── mcp-server.ts           # MCP 工具/资源注册（registerTool API）
│   └── protocol-translator.ts  # Turn 累积器 + 智能输出摘要
├── codex-protocol/
│   ├── types.ts                # Codex JSON-RPC 协议类型
│   ├── json-rpc.ts             # 消息帧与解析
│   └── process-manager.ts      # Codex 进程生命周期
├── sessions/
│   ├── session.ts              # 会话 + 任务状态
│   ├── session-manager.ts      # 会话生命周期
│   └── context-store.ts        # 共享上下文键值存储
├── tools/                      # MCP 工具实现
└── utils/                      # 配置、日志、错误、事件
```

## Codex 协议集成

### 关键协议细节

- `initialize` 通过 `capabilities.optOutNotificationMethods` 关闭 `item/commandExecution/outputDelta`
- 输出数据来自 `item/completed` 通知（`commandExecution.aggregatedOutput`）
- `turn/completed.turn.items` 在 Codex v2 协议中为空数组 — 所有 item 数据通过 `item/completed` 到达
- `initialized` 是通知（无 id），不是请求
- WebSocket 消息已自带帧 — 喂给 `parseBuffer` 前需追加 `\n`

### 审批与沙箱

- `approvalPolicy`：`untrusted | on-failure | on-request | granular | never`
- `sandbox`：`read-only | workspace-write | danger-full-access`

## 配置

| 环境变量 | 默认值 | 说明 |
|---------|--------|------|
| `CODEX_PATH` | `codex` | Codex 二进制文件路径 |
| `CODEX_WS_PORT` | *（自动分配）* | app-server 的 WebSocket 端口 |
| `CODEX_MODEL` | *（默认）* | Codex 模型覆盖 |
| `CODEX_TRANSPORT` | `ws` | 传输模式：`ws` 或 `stdio` |

## 开发

```bash
npm run build       # 编译 TypeScript
npm run dev         # tsx 开发模式运行
npm test            # 运行单元测试（56 个）
npm run test:watch  # 监听模式
```

## MCP 资源

| URI | 说明 |
|-----|------|
| `bridge://session` | 当前会话信息（JSON） |
| `bridge://tasks` | 任务列表及状态（JSON） |
