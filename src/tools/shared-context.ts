import { z } from "zod";
import type { AgentBridge } from "../bridge/agent-bridge.js";

export const sharedContextWriteSchema = {
  key: z.string().min(1).describe("Context key (e.g. 'project_requirements', 'coding_style')"),
  value: z.string().describe("Context value to store"),
};

export const sharedContextReadSchema = {
  key: z.string().optional().describe("Specific key to read. Omit to list all entries."),
};

export const sharedContextDeleteSchema = {
  key: z.string().min(1).describe("Context key to delete"),
};

export function sharedContextWriteDescription(): string {
  return `Write a key-value pair to the shared context store. This context is automatically included when delegating tasks to Codex, so both agents share the same understanding.

Args:
  - key (string, required): Context key identifier.
  - value (string, required): Context value to store. Overwrites any existing value for this key.

Returns:
  Confirmation message.

Examples:
  - key="coding_style", value="Use TypeScript strict mode, prefer async/await" → style guide for Codex
  - key="project_goal", value="Migrate from Express to Fastify" → shared project context`;
}

export function sharedContextReadDescription(): string {
  return `Read from the shared context store. Returns a specific entry or all entries.

Args:
  - key (string, optional): Specific key to read. Omit to list all entries with metadata.

Returns:
  JSON with the context entry (key, value, source, updatedAt) or all entries.`;
}

export function sharedContextDeleteDescription(): string {
  return `Delete a key from the shared context store.

Args:
  - key (string, required): Context key to delete.

Returns:
  Confirmation or "not found" message.`;
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
