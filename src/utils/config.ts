export interface AgentBridgeConfig {
  codex: {
    binaryPath: string;
    transport: "stdio" | "ws";
    wsUrl?: string;
    model?: string;
    approvalPolicy: "auto" | "auto-session" | "decline";
    sandbox?: "read-only" | "workspace-write" | "danger-full-access";
  };
  bridge: {
    delegateTimeoutMs: number;
    askTimeoutMs: number;
    maxConcurrentTasks: number;
    autoStartThread: boolean;
  };
}

export const defaultConfig: AgentBridgeConfig = {
  codex: {
    binaryPath: "codex",
    transport: "stdio",
    approvalPolicy: "auto",
    sandbox: "danger-full-access",
  },
  bridge: {
    delegateTimeoutMs: 300_000,
    askTimeoutMs: 30_000,
    maxConcurrentTasks: 3,
    autoStartThread: true,
  },
};

export function loadConfig(
  overrides?: Partial<AgentBridgeConfig>,
): AgentBridgeConfig {
  return {
    codex: { ...defaultConfig.codex, ...overrides?.codex },
    bridge: { ...defaultConfig.bridge, ...overrides?.bridge },
  };
}
