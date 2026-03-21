import { z } from "zod";
import type { AgentBridge } from "../bridge/agent-bridge.js";

export const sharedContextWriteSchema = {
  key: z.string().describe("Context key"),
  value: z.string().describe("Context value"),
};

export const sharedContextReadSchema = {
  key: z.string().optional().describe("Specific key to read, or omit for all"),
};

export const sharedContextDeleteSchema = {
  key: z.string().describe("Context key to delete"),
};

export function sharedContextWriteDescription(): string {
  return "Write a key-value pair to the shared context store. This context will be included when delegating tasks to Codex.";
}

export function sharedContextReadDescription(): string {
  return "Read from the shared context store. Returns a specific entry or all entries.";
}

export function sharedContextDeleteDescription(): string {
  return "Delete a key from the shared context store.";
}

export async function handleSharedContextWrite(
  bridge: AgentBridge,
  args: { key: string; value: string },
): Promise<string> {
  const session = bridge.getOrCreateSession();
  session.context.set(args.key, args.value, "claude");
  return `Context "${args.key}" saved.`;
}

export async function handleSharedContextRead(
  bridge: AgentBridge,
  args: { key?: string },
): Promise<string> {
  const session = bridge.sessionManager.getActiveSession();
  if (!session) return "No active session.";

  if (args.key) {
    const entry = session.context.get(args.key);
    if (!entry) return `Key "${args.key}" not found.`;
    return JSON.stringify(entry, null, 2);
  }

  const entries = session.context.list();
  if (entries.length === 0) return "Shared context is empty.";
  return JSON.stringify(entries, null, 2);
}

export async function handleSharedContextDelete(
  bridge: AgentBridge,
  args: { key: string },
): Promise<string> {
  const session = bridge.sessionManager.getActiveSession();
  if (!session) return "No active session.";

  const deleted = session.context.delete(args.key);
  return deleted
    ? `Context "${args.key}" deleted.`
    : `Key "${args.key}" not found.`;
}
