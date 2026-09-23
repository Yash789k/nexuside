import { readFile, writeFile, mkdir } from "node:fs/promises";
import { z } from "zod";
import { Engine, startSchema, approvalRevision } from "../core/engine";
import { fileTransaction } from "../core/file-lock";
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
  private removedKeys = new Set<string>();
  private jobErrors = new Map<string, string>();
  private jobs = new Map<string, Promise<unknown>>();
  hasActiveJobs() {
    return this.jobs.size > 0;
  }
  async shutdown() {
    const jobs = [...this.jobs.entries()];
    await Promise.all(jobs.map(([id]) => this.engine.cancel(id)));
    await Promise.all(jobs.map(([, job]) => job));
  }
  constructor(
    public workspace: Workspace,
    private externalKey?: KeyResolver,
    private persistKey?: (env: string, key: string) => Promise<void>,
  ) {
    this.engine = new Engine(workspace, async (m) =>
      this.removedKeys.has(m.keyEnv ?? "")
        ? undefined
        : (this.keys.get(m.keyEnv ?? "") ??
          (await externalKey?.(m)) ??
          (await envKey(m))),
    );
  }
  async modelStates() {
    const c = await loadConfig();
    const configured = await available(c, async (m) =>
      this.removedKeys.has(m.keyEnv ?? "")
        ? undefined
        : (this.keys.get(m.keyEnv ?? "") ??
          (await this.externalKey?.(m)) ??
          (await envKey(m))),
    );
    return c.models.map((m) => ({
      ...m,
      configured: configured.some((a) => a.id === m.id),
    }));
  }
  private background(id: string, fn: () => Promise<unknown>) {
    if (this.jobs.has(id)) throw new Error("Run is already active");
    this.jobErrors.delete(id);
    const job = fn()
      .catch((e) => {
        this.jobErrors.set(id, e.message);
      })
      .finally(() => this.jobs.delete(id));
    this.jobs.set(id, job);
  }
  async request(action: string, raw: unknown = {}): Promise<unknown> {
    const data = (raw ?? {}) as Record<string, any>;
    switch (action) {
      case "state": {
        const index = await this.workspace.index();
        return {
          workspace: this.workspace.root,
          name: this.workspace.root.split(/[\\/]/).at(-1),
          models: await this.modelStates(),
          config: await loadConfig(),
          configPath: configPath(),
          files: index.files,
          index,
          runs: (await this.engine.store.list()).map((r) => ({
            id: r.id,
            prompt: r.prompt,
            status: r.status,
            createdAt: r.createdAt,
            modelId: r.modelId,
          })),
          version: "0.3.0",
          credentialStorage: this.persistKey
            ? "System credential store"
            : "Session memory",
        };
      }
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
        const events = await this.engine.store.events(r.id);
        return {
          ...r,
          operationError: this.jobErrors.get(r.id),
          pending: r.pending
            ? { ...r.pending, revision: approvalRevision(r) }
            : undefined,
          messages: r.messages.map((m) => ({
            ...m,
            reasoning: undefined,
            reasoningDetails: undefined,
            attachments: m.attachments?.map((a) => ({
              name: a.name,
              mime: a.mime,
            })),
          })),
          events,
          evaluation: evaluate(
            r,
            events,
            await this.engine.store.verify(r.id, events),
          ),
        };
      }
      case "start": {
        const input = startSchema.parse(data);
        const requestId = z.string().uuid().optional().parse(data.requestId);
        let created = false;
        const r = await fileTransaction(this.workspace.root, async () => {
          if (requestId) {
            try {
              return await this.engine.store.get(
                await readFile(
                  await this.workspace.resolve(
                    `.nexus/submissions/${requestId}`,
                    true,
                  ),
                  "utf8",
                ),
              );
            } catch (e) {
              if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
            }
          }
          const run = await this.engine.create(input);
          created = true;
          if (requestId)
            await this.workspace.atomicWrite(
              `.nexus/submissions/${requestId}`,
              run.id,
              true,
            );
          return run;
        });
        if (created) this.background(r.id, () => this.engine.drive(r.id));
        return { id: r.id };
      }
      case "decision": {
        const args = z
          .object({
            id: z.string(),
            approved: z.boolean(),
            revision: z.string().length(64),
          })
          .parse(data);
        const current = await this.engine.store.get(args.id);
        if (!current.pending || approvalRevision(current) !== args.revision)
          throw new Error("This approval is stale. Review the current action.");
        this.background(args.id, async () => {
          const r = await this.engine.decide(
            args.id,
            args.approved,
            args.revision,
          );
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
        return this.workspace.save(v.path, v.before, v.content);
      }
      case "search": {
        const query = z.string().min(1).max(200).parse(data.query);
        const [hits, index] = await Promise.all([
          this.workspace.search(query),
          this.workspace.index(),
        ]);
        return {
          hits,
          limited: index.limited || hits.length >= 100,
          limit: 100,
        };
      }
      case "filePreview":
        return {
          revision: await this.workspace.fileRevision(
            z.string().parse(data.path),
          ),
        };
      case "fileOperation":
        return this.workspace.fileOperation(
          z
            .object({
              kind: z.enum(["folder", "rename", "delete"]),
              path: z.string(),
              target: z.string().optional(),
              revision: z.string().length(64).optional(),
            })
            .parse(data),
        );
      case "restoreFile":
        return this.workspace.restore(z.string().parse(data.trash));
      case "fileSnapshots": {
        const paths = z.array(z.string()).max(100).parse(data.paths);
        return Promise.all(
          paths.map(async (path) => {
            try {
              return { path, content: await this.workspace.current(path) };
            } catch (e) {
              return { path, error: (e as Error).message };
            }
          }),
        );
      }
      case "editorSession": {
        const id = z.string().uuid().parse(data.id);
        const file = `.nexus/editor-sessions/${id}.json`;
        if (data.session !== undefined) {
          const text = JSON.stringify(data.session);
          if (Buffer.byteLength(text) > 24_000_000)
            throw new Error(
              "Recovery storage limit is 24 MB. Save some documents before continuing.",
            );
          await this.workspace.atomicWrite(file, text, true);
          return { ok: true };
        }
        try {
          return JSON.parse(
            await readFile(await this.workspace.resolve(file, true), "utf8"),
          );
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
          throw e;
        }
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
            key: z.string().min(8).max(500).optional(),
            remove: z.boolean().optional(),
          })
          .parse(data);
        const c = await loadConfig();
        if (!c.models.some((m) => m.keyEnv === v.env))
          throw new Error("Unknown provider key");
        if (v.remove) {
          this.keys.delete(v.env);
          this.removedKeys.add(v.env);
          if (this.persistKey) await this.persistKey(v.env, "");
        } else {
          if (!v.key) throw new Error("Enter a provider key");
          this.removedKeys.delete(v.env);
          if (this.persistKey) await this.persistKey(v.env, v.key);
          else this.keys.set(v.env, v.key);
        }
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
