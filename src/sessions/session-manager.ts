import { BridgeSession } from "./session.js";
import { logger } from "../utils/logger.js";

export class SessionManager {
  private sessions = new Map<string, BridgeSession>();
  private activeSession: BridgeSession | null = null;

  createSession(): BridgeSession {
    const session = new BridgeSession();
    this.sessions.set(session.id, session);
    this.activeSession = session;
    logger.info("Session created:", session.id);
    return session;
  }

  getSession(id: string): BridgeSession | undefined {
    return this.sessions.get(id);
  }

  getActiveSession(): BridgeSession | null {
    return this.activeSession;
  }

  getOrCreateActiveSession(): BridgeSession {
    if (this.activeSession && this.activeSession.status === "active") {
      return this.activeSession;
    }
    return this.createSession();
  }

  findByThreadId(threadId: string): BridgeSession | undefined {
    for (const session of this.sessions.values()) {
      if (session.codexThreadId === threadId) return session;
    }
    return undefined;
  }

  listSessions(): BridgeSession[] {
    return Array.from(this.sessions.values());
  }

  closeSession(id: string): void {
    const session = this.sessions.get(id);
    if (session) {
      session.status = "completed";
      session.context.clear();
      this.sessions.delete(id);
      if (this.activeSession?.id === id) {
        this.activeSession = null;
      }
      logger.info("Session closed:", id);
    }
  }
}
