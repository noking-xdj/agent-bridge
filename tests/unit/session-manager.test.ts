import { describe, it, expect } from "vitest";
import { SessionManager } from "../../src/sessions/session-manager.js";

describe("SessionManager", () => {
  it("creates a session", () => {
    const mgr = new SessionManager();
    const session = mgr.createSession();
    expect(session.id).toBeDefined();
    expect(session.status).toBe("initializing");
  });

  it("retrieves a session by ID", () => {
    const mgr = new SessionManager();
    const session = mgr.createSession();
    expect(mgr.getSession(session.id)).toBe(session);
  });

  it("tracks the active session", () => {
    const mgr = new SessionManager();
    expect(mgr.getActiveSession()).toBeNull();
    const session = mgr.createSession();
    expect(mgr.getActiveSession()).toBe(session);
  });

  it("getOrCreateActiveSession reuses active session", () => {
    const mgr = new SessionManager();
    const s1 = mgr.getOrCreateActiveSession();
    s1.status = "active";
    const s2 = mgr.getOrCreateActiveSession();
    expect(s2.id).toBe(s1.id);
  });

  it("getOrCreateActiveSession creates new when no active", () => {
    const mgr = new SessionManager();
    const s1 = mgr.createSession();
    mgr.closeSession(s1.id);
    const s2 = mgr.getOrCreateActiveSession();
    expect(s2.id).not.toBe(s1.id);
  });

  it("finds session by thread ID", () => {
    const mgr = new SessionManager();
    const session = mgr.createSession();
    session.codexThreadId = "thread-123";
    expect(mgr.findByThreadId("thread-123")).toBe(session);
    expect(mgr.findByThreadId("unknown")).toBeUndefined();
  });

  it("closes a session", () => {
    const mgr = new SessionManager();
    const session = mgr.createSession();
    mgr.closeSession(session.id);
    expect(session.status).toBe("completed");
    expect(mgr.getActiveSession()).toBeNull();
  });

  it("lists all sessions", () => {
    const mgr = new SessionManager();
    mgr.createSession();
    mgr.createSession();
    expect(mgr.listSessions()).toHaveLength(2);
  });
});

describe("BridgeSession", () => {
  it("creates and tracks tasks", () => {
    const mgr = new SessionManager();
    const session = mgr.createSession();

    const task = session.createTask("Test task");
    expect(task.status).toBe("pending");
    expect(session.tasks.get(task.id)).toBe(task);
  });

  it("updates task status", () => {
    const mgr = new SessionManager();
    const session = mgr.createSession();
    const task = session.createTask("Test");

    session.updateTask(task.id, { status: "running" });
    expect(task.status).toBe("running");

    session.updateTask(task.id, {
      status: "completed",
      result: "done",
    });
    expect(task.status).toBe("completed");
    expect(task.result).toBe("done");
    expect(task.completedAt).not.toBeNull();
  });

  it("returns active tasks", () => {
    const mgr = new SessionManager();
    const session = mgr.createSession();
    session.createTask("t1");
    const t2 = session.createTask("t2");
    session.updateTask(t2.id, { status: "completed" });

    expect(session.getActiveTasks()).toHaveLength(1);
  });
});
