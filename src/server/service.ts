import { readFile, writeFile, mkdir } from "node:fs/promises";
import { z } from "zod";
import { Engine, startSchema } from "../core/engine";
import { Workspace } from "../core/workspace";
import {
  loadConfig,
  saveConfig,
  envKey,
  configSchema,
  configPath,
} from "../core/config";
import { available } from "../core/router";
import { evaluate } from "../core/evaluation";
import { git } from "../core/process";
import { openRouterCatalog } from "../core/catalog";
import type { KeyResolver, Run } from "../core/types";
export class Service {
  readonly engine: Engine;
  private keys = new Map<string, string>();
  private jobs = new Map<string, Promise<unknown>>();
  constructor(
    public workspace: Workspace,
    private externalKey?: KeyResolver,
    private persistKey?: (env: string, key: string) => Promise<void>,
  ) {
    this.engine = new Engine(
      workspace,
      async (m) =>
        this.keys.get(m.keyEnv ?? "") ??
        (await externalKey?.(m)) ??
        (await envKey(m)),
    );
  }
  async modelStates() {
    const c = await loadConfig();
    const configured = await available(
      c,
      async (m) =>
        this.keys.get(m.keyEnv ?? "") ??
        (await this.externalKey?.(m)) ??
        (await envKey(m)),
    );
    return c.models.map((m) => ({
      ...m,
      configured: configured.some((a) => a.id === m.id),
    }));
  }
  private background(id: string, fn: () => Promise<unknown>) {
    if (this.jobs.has(id)) throw new Error("Run is already active");
    const job = fn()
      .catch(async (e) => {
        const r = await this.engine.store.get(id);
        r.status = "failed";
        r.error = e.message;
        await this.engine.store.trace(id, "run_error", { error: e.message });
        await this.engine.store.save(r);
      })
      .finally(() => this.jobs.delete(id));
    this.jobs.set(id, job);
  }
  async request(action: string, raw: unknown = {}): Promise<unknown> {
    const data = (raw ?? {}) as Record<string, any>;
    switch (action) {
      case "state":
        return {
          workspace: this.workspace.root,
          name: this.workspace.root.split(/[\\/]/).at(-1),
          models: await this.modelStates(),
          config: await loadConfig(),
          configPath: configPath(),
          files: await this.workspace.list(),
          runs: (await this.engine.store.list()).map((r) => ({
            id: r.id,
            prompt: r.prompt,
            status: r.status,
            createdAt: r.createdAt,
            modelId: r.modelId,
          })),
          version: "0.1.0",
          credentialStorage: this.persistKey
            ? "System credential store"
            : "Session memory",
        };
      case "openrouterCatalog": {
        const query = z
          .object({
            search: z.string().max(100).default(""),
            modality: z
              .enum(["", "text", "image", "audio", "video"])
              .default(""),
          })
          .parse(data);
        return openRouterCatalog(query.search, query.modality);
      }
      case "run": {
        const r = await this.engine.store.get(z.string().parse(data.id));
        return {
          ...r,
          messages: r.messages.map((m) => ({
            ...m,
            reasoning: undefined,
            reasoningDetails: undefined,
            attachments: m.attachments?.map((a) => ({
              name: a.name,
              mime: a.mime,
            })),
          })),
          events: await this.engine.store.events(r.id),
          evaluation: evaluate(
            r,
            await this.engine.store.events(r.id),
            await this.engine.store.verify(r.id),
          ),
        };
      }
      case "start": {
        const input = startSchema.parse(data);
        const r = await this.engine.create(input);
        this.background(r.id, () => this.engine.drive(r.id));
        return { id: r.id };
      }
      case "decision": {
        const args = z
          .object({ id: z.string(), approved: z.boolean() })
          .parse(data);
        this.background(args.id, async () => {
          const r = await this.engine.decide(args.id, args.approved);
          if (r.status === "running") await this.engine.drive(r.id);
        });
        return { ok: true };
      }
      case "resume": {
        const r = await this.engine.store.get(z.string().parse(data.id));
        if (r.status !== "running")
          throw new Error("Only an interrupted running task can be resumed");
        this.background(r.id, () => this.engine.drive(r.id));
        return { ok: true };
      }
      case "cancel":
        await this.engine.cancel(z.string().parse(data.id));
        return { ok: true };
      case "file":
        return {
          path: z.string().parse(data.path),
          content: await this.workspace.read(data.path),
        };
      case "saveFile": {
        const v = z
          .object({
            path: z.string(),
            before: z.string().nullable(),
            content: z.string().max(512_000),
          })
          .parse(data);
        const changes = await this.workspace.stage([
          { path: v.path, content: v.content },
        ]);
        if (changes[0].before !== v.before)
          throw new Error("File changed externally. Reopen it before saving.");
        await this.workspace.apply(changes);
        return { ok: true };
      }
      case "config":
        if (this.jobs.size)
          throw new Error(
            "Wait for the current task to pause before changing Settings",
          );
        return saveConfig(configSchema.parse(data.config));
      case "key": {
        const v = z
          .object({
            env: z.string().regex(/^[A-Z_][A-Z0-9_]*$/),
            key: z.string().min(8).max(500),
          })
          .parse(data);
        const c = await loadConfig();
        if (!c.models.some((m) => m.keyEnv === v.env))
          throw new Error("Unknown provider key");
        if (this.persistKey) await this.persistKey(v.env, v.key);
        else this.keys.set(v.env, v.key);
        return { ok: true };
      }
      case "metrics": {
        const runs = await this.engine.store.list();
        return Promise.all(
          runs.map(async (r) => ({
            ...evaluate(
              r,
              await this.engine.store.events(r.id),
              await this.engine.store.verify(r.id),
            ),
            prompt: r.prompt,
            modelId: r.modelId,
            createdAt: r.createdAt,
          })),
        );
      }
      case "git":
        return {
          status: await git(this.workspace.root, ["status", "--short"]),
          diff: await git(this.workspace.root, [
            "diff",
            "--no-ext-diff",
            "--no-textconv",
            "--",
          ]),
        };
      case "screenshot": {
        const id = z
          .string()
          .regex(/^[a-f0-9-]{36}-\d+(?:-\d+)?$/)
          .parse(data.id);
        return {
          data: await readFile(
            await this.workspace.resolve(`.nexus/screenshots/${id}.b64`, true),
            "utf8",
          ),
        };
      }
      default:
        throw new Error("Unknown action");
    }
  }
}
