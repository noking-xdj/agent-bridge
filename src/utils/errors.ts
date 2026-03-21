export class BridgeError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message);
    this.name = "BridgeError";
  }
}

export class CodexConnectionError extends BridgeError {
  constructor(message: string) {
    super(message, "CODEX_CONNECTION_ERROR");
    this.name = "CodexConnectionError";
  }
}

export class CodexTimeoutError extends BridgeError {
  constructor(message: string) {
    super(message, "CODEX_TIMEOUT");
    this.name = "CodexTimeoutError";
  }
}

export class CodexProcessError extends BridgeError {
  constructor(message: string) {
    super(message, "CODEX_PROCESS_ERROR");
    this.name = "CodexProcessError";
  }
}
