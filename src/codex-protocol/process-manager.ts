import { spawn, type ChildProcess } from "node:child_process";
import { logger } from "../utils/logger.js";
import { CodexProcessError } from "../utils/errors.js";

export interface ProcessManagerOptions {
  binaryPath: string;
  transport: "stdio" | "ws";
  wsUrl?: string;
}

export class ProcessManager {
  private process: ChildProcess | null = null;
  private _exited = false;

  constructor(private options: ProcessManagerOptions) {}

  get exited(): boolean {
    return this._exited;
  }

  start(): ChildProcess {
    if (this.process && !this._exited) {
      return this.process;
    }

    const args = ["app-server"];

    if (this.options.transport === "ws" && this.options.wsUrl) {
      // WebSocket mode: app-server listens on a WS port, clients connect to it
      args.push("--listen", this.options.wsUrl);
    } else {
      args.push("--listen", "stdio://");
    }

    logger.info(
      `Starting Codex: ${this.options.binaryPath} ${args.join(" ")}`,
    );

    this.process = spawn(this.options.binaryPath, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env },
    });

    this._exited = false;

    this.process.on("error", (err) => {
      logger.error("Codex process error:", err.message);
      this._exited = true;
    });

    this.process.on("exit", (code, signal) => {
      logger.info(`Codex process exited: code=${code}, signal=${signal}`);
      this._exited = true;
    });

    this.process.stderr?.on("data", (data: Buffer) => {
      logger.debug("Codex stderr:", data.toString().trim());
    });

    return this.process;
  }

  stop(): Promise<void> {
    if (!this.process || this._exited) {
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      logger.info("Stopping Codex process");
      const proc = this.process!;

      const forceKillTimer = setTimeout(() => {
        if (!this._exited) {
          proc.kill("SIGKILL");
        }
      }, 5000);

      proc.on("exit", () => {
        clearTimeout(forceKillTimer);
        resolve();
      });

      proc.kill("SIGTERM");
    });
  }

  getProcess(): ChildProcess {
    if (!this.process || this._exited) {
      throw new CodexProcessError("Codex process is not running");
    }
    return this.process;
  }
}
