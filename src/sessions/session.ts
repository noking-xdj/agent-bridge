import { randomUUID } from "node:crypto";
import { ContextStore } from "./context-store.js";
import type { ThreadItem } from "../codex-protocol/types.js";

export type SessionStatus = "initializing" | "active" | "completed" | "error";
export type TaskStatus = "pending" | "running" | "completed" | "failed";

export interface TaskRecord {
  id: string;
  description: string;
  status: TaskStatus;
  codexTurnId: string | null;
  result: string | null;
  error: string | null;
  startedAt: number;
  completedAt: number | null;
  items: ThreadItem[];
}

export class BridgeSession {
  readonly id: string;
  codexThreadId: string | null = null;
  status: SessionStatus = "initializing";
  readonly tasks = new Map<string, TaskRecord>();
  readonly context = new ContextStore();
  readonly createdAt: number;
  lastActivityAt: number;

  constructor() {
    this.id = randomUUID();
    this.createdAt = Date.now();
    this.lastActivityAt = Date.now();
  }

  createTask(description: string): TaskRecord {
    const task: TaskRecord = {
      id: randomUUID(),
      description,
      status: "pending",
      codexTurnId: null,
      result: null,
      error: null,
      startedAt: Date.now(),
      completedAt: null,
      items: [],
    };
    this.tasks.set(task.id, task);
    this.lastActivityAt = Date.now();
    return task;
  }

  updateTask(
    taskId: string,
    update: Partial<Pick<TaskRecord, "status" | "result" | "error" | "codexTurnId">>,
  ): TaskRecord | undefined {
    const task = this.tasks.get(taskId);
    if (!task) return undefined;

    Object.assign(task, update);
    if (update.status === "completed" || update.status === "failed") {
      task.completedAt = Date.now();
    }
    this.lastActivityAt = Date.now();
    return task;
  }

  getActiveTasks(): TaskRecord[] {
    return Array.from(this.tasks.values()).filter(
      (t) => t.status === "pending" || t.status === "running",
    );
  }

  toSummary(): Record<string, unknown> {
    return {
      id: this.id,
      codexThreadId: this.codexThreadId,
      status: this.status,
      taskCount: this.tasks.size,
      activeTasks: this.getActiveTasks().length,
      contextEntries: this.context.list().length,
      createdAt: new Date(this.createdAt).toISOString(),
      lastActivityAt: new Date(this.lastActivityAt).toISOString(),
    };
  }
}
