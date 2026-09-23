import { appendFile, mkdir, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { Run, TraceEvent } from "./types";
import { Workspace } from "./workspace";
const hash = (s: string) => createHash("sha256").update(s).digest("hex");
export function redact(text: string) {
  return text
    .replace(/\bsk-[\w-]{12,}\b/g, "[REDACTED]")
    .replace(/\bgh[pousr]_[\w]{16,}\b/g, "[REDACTED]")
    .replace(/(Bearer\s+)[\w.\-]{16,}/gi, "$1[REDACTED]")
    .replace(
      /((?:api[_-]?key|password|secret|token)\s*[=:]\s*)[^\s,;]+/gi,
      "$1[REDACTED]",
    );
}
export class Store {
  constructor(public workspace: Workspace) {}
  private check(id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new Error("Invalid run ID");
  }
  async save(run: Run) {
    this.check(run.id);
    try {
      await readFile(await this.workspace.resolve(".nexus/.gitignore", true));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT")
        await this.workspace.atomicWrite(".nexus/.gitignore", "*\n", true);
      else throw e;
    }
    run.updatedAt = new Date().toISOString();
    await this.workspace.atomicWrite(
      `.nexus/runs/${run.id}.json`,
      JSON.stringify(run),
      true,
    );
  }
  async get(id: string): Promise<Run> {
    this.check(id);
    return JSON.parse(
      await readFile(
        await this.workspace.resolve(`.nexus/runs/${id}.json`, true),
        "utf8",
      ),
    );
  }
  async list(): Promise<Run[]> {
    let names: string[];
    try {
      names = await readdir(await this.workspace.resolve(".nexus/runs", true));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
    const runs: Run[] = [];
    for (const n of names.filter((n) => n.endsWith(".json"))) {
      try {
        runs.push(await this.get(n.slice(0, -5)));
      } catch {}
    }
    return runs.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  async events(id: string): Promise<TraceEvent[]> {
    this.check(id);
    try {
      return (
        await readFile(
          await this.workspace.resolve(`.nexus/traces/${id}.jsonl`, true),
          "utf8",
        )
      )
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((s) => JSON.parse(s));
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw e;
    }
  }
  async trace(id: string, type: string, data: Record<string, unknown>) {
    const previous = await this.events(id);
    const entry = {
      seq: previous.length + 1,
      time: new Date().toISOString(),
      type,
      data: JSON.parse(redact(JSON.stringify(data))),
      previousHash: previous.at(-1)?.hash ?? "0".repeat(64),
    };
    const event = { ...entry, hash: hash(JSON.stringify(entry)) };
    const dest = await this.workspace.resolve(
      `.nexus/traces/${id}.jsonl`,
      true,
    );
    await mkdir(await this.workspace.resolve(".nexus/traces", true), {
      recursive: true,
    });
    await appendFile(dest, JSON.stringify(event) + "\n", { mode: 0o600 });
    return event;
  }
  async verify(id: string, supplied?: TraceEvent[]) {
    const events = supplied ?? (await this.events(id));
    if (!events.length) return false;
    let prev = "0".repeat(64);
    for (let i = 0; i < events.length; i++) {
      const { hash: h, ...entry } = events[i];
      if (
        entry.seq !== i + 1 ||
        entry.previousHash !== prev ||
        hash(JSON.stringify(entry)) !== h
      )
        return false;
      prev = h;
    }
    return true;
  }
}
