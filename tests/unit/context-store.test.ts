import { describe, it, expect } from "vitest";
import { ContextStore } from "../../src/sessions/context-store.js";

describe("ContextStore", () => {
  it("sets and gets entries", () => {
    const store = new ContextStore();
    store.set("key1", "value1", "claude");
    const entry = store.get("key1");
    expect(entry?.value).toBe("value1");
    expect(entry?.source).toBe("claude");
  });

  it("overwrites existing entries", () => {
    const store = new ContextStore();
    store.set("key1", "v1", "claude");
    store.set("key1", "v2", "codex");
    expect(store.get("key1")?.value).toBe("v2");
    expect(store.get("key1")?.source).toBe("codex");
  });

  it("deletes entries", () => {
    const store = new ContextStore();
    store.set("key1", "v1", "claude");
    expect(store.delete("key1")).toBe(true);
    expect(store.get("key1")).toBeUndefined();
    expect(store.delete("nonexistent")).toBe(false);
  });

  it("lists all entries", () => {
    const store = new ContextStore();
    store.set("a", "1", "claude");
    store.set("b", "2", "codex");
    expect(store.list()).toHaveLength(2);
  });

  it("generates prompt string", () => {
    const store = new ContextStore();
    store.set("project", "AgentBridge", "claude");
    store.set("language", "TypeScript", "codex");

    const prompt = store.toPromptString();
    expect(prompt).toContain("[Shared Context]");
    expect(prompt).toContain("project");
    expect(prompt).toContain("AgentBridge");
  });

  it("returns empty string for empty store", () => {
    const store = new ContextStore();
    expect(store.toPromptString()).toBe("");
  });

  it("clears all entries", () => {
    const store = new ContextStore();
    store.set("a", "1", "claude");
    store.set("b", "2", "codex");
    store.clear();
    expect(store.list()).toHaveLength(0);
  });
});
