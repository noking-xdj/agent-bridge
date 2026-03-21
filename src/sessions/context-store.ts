export interface ContextEntry {
  key: string;
  value: string;
  source: "claude" | "codex";
  updatedAt: number;
}

export class ContextStore {
  private entries = new Map<string, ContextEntry>();

  set(key: string, value: string, source: "claude" | "codex"): void {
    this.entries.set(key, { key, value, source, updatedAt: Date.now() });
  }

  get(key: string): ContextEntry | undefined {
    return this.entries.get(key);
  }

  delete(key: string): boolean {
    return this.entries.delete(key);
  }

  list(): ContextEntry[] {
    return Array.from(this.entries.values());
  }

  toPromptString(): string {
    if (this.entries.size === 0) return "";

    const lines = ["[Shared Context]"];
    for (const entry of this.entries.values()) {
      lines.push(`- ${entry.key} (from ${entry.source}): ${entry.value}`);
    }
    return lines.join("\n");
  }

  clear(): void {
    this.entries.clear();
  }
}
