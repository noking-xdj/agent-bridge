// Logger that writes to stderr to avoid interfering with MCP stdio transport
export const logger = {
  info: (...args: unknown[]) => console.error("[AgentBridge]", ...args),
  warn: (...args: unknown[]) => console.error("[AgentBridge WARN]", ...args),
  error: (...args: unknown[]) => console.error("[AgentBridge ERROR]", ...args),
  debug: (...args: unknown[]) => {
    if (process.env.DEBUG) console.error("[AgentBridge DEBUG]", ...args);
  },
};
