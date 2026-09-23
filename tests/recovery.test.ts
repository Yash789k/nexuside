import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Workspace } from "../src/core/workspace";
import { Engine } from "../src/core/engine";
import { defaults } from "../src/core/config";
import { git } from "../src/core/process";
const fixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexus-recovery-"));
  return {
    root,
    workspace: await Workspace.open(root),
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};
test("a second engine can cancel an in-flight provider call without the first resurrecting the run", async () => {
  const f = await fixture();
  let arrived!: () => void;
  const requestStarted = new Promise<void>((r) => (arrived = r));
  const server = createServer((req, res) => {
    arrived();
    req.resume();
    const timer = setTimeout(() => {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "late response" } }],
        }),
      );
    }, 4000);
    res.on("close", () => clearTimeout(timer));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const c = structuredClone(defaults);
    c.models = [
      {
        ...c.models[0],
        keyEnv: undefined,
        baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
      },
    ];
    const one = new Engine(f.workspace),
      two = new Engine(f.workspace);
    const r = await one.create({ prompt: "Say hello" }, c);
    const running = one.drive(r.id);
    await requestStarted;
    await two.cancel(r.id);
    const end = await running;
    assert.equal(end.status, "cancelled");
    assert.equal((await one.store.get(r.id)).status, "cancelled");
    assert.equal(end.summary, undefined);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await f.cleanup();
  }
});
test("temporary failure falls back to another real provider and records the choice", async () => {
  const f = await fixture();
  const server = createServer((req, res) => {
    req.resume();
    if (req.url?.startsWith("/fail/")) {
      res.writeHead(503, { "Content-Type": "application/json" });
      res.end('{"error":"temporary"}');
    } else {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          choices: [{ message: { content: "Successful fallback" } }],
          usage: { prompt_tokens: 2, completion_tokens: 2 },
        }),
      );
    }
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const c = structuredClone(defaults);
    const base = `http://127.0.0.1:${(server.address() as any).port}`;
    c.models = [
      {
        ...c.models[0],
        id: "first",
        keyEnv: undefined,
        baseUrl: base + "/fail",
      },
      {
        ...c.models[0],
        id: "second",
        keyEnv: undefined,
        baseUrl: base + "/ok",
      },
    ];
    const e = new Engine(f.workspace);
    const r = await e.create({ prompt: "Explain code" }, c);
    const end = await e.drive(r.id);
    assert.equal(end.status, "completed");
    assert.equal(end.modelId, "second");
    assert.ok((await e.store.events(r.id)).some((e) => e.type === "fallback"));
  } finally {
    await new Promise<void>((r) => server.close(() => r()));
    await f.cleanup();
  }
});
test("budget guard blocks a call before spending when the configured estimate exceeds the run limit", async () => {
  const f = await fixture();
  try {
    const c = structuredClone(defaults);
    c.maxBudget = 0.000001;
    c.models = [{ ...c.models[0], keyEnv: undefined }];
    const e = new Engine(f.workspace);
    const r = await e.create({ prompt: "Say hello" }, c);
    const end = await e.drive(r.id);
    assert.equal(end.status, "failed");
    assert.match(end.error!, /budget/);
    assert.equal(end.cost, 0);
  } finally {
    await f.cleanup();
  }
});
test("approved Git commit preserves unrelated staged changes", async () => {
  const f = await fixture();
  const g = async (args: string[]) => {
    const r = await git(f.root, args);
    assert.equal(r.exitCode, 0, r.output);
    return r.output;
  };
  try {
    await g(["init"]);
    await g(["config", "user.name", "Nexus Test"]);
    await g(["config", "user.email", "nexus-test@example.invalid"]);
    await writeFile(path.join(f.root, "a.txt"), "original");
    await writeFile(path.join(f.root, "b.txt"), "original");
    await g(["add", "a.txt", "b.txt"]);
    await g(["commit", "-m", "Initial"]);
    await writeFile(path.join(f.root, "a.txt"), "agent edit");
    await writeFile(path.join(f.root, "b.txt"), "user staged edit");
    await g(["add", "b.txt"]);
    const e = new Engine(f.workspace);
    const run = await e.create(
      { prompt: "Commit the agent edit", model: "demo" },
      structuredClone(defaults),
    );
    run.changes = [
      {
        path: "a.txt",
        before: "original",
        after: "agent edit",
        diff: "",
        applied: true,
      },
    ];
    run.status = "awaiting_approval";
    run.pending = {
      kind: "commit",
      title: "Commit",
      detail: "Commit agent edit",
      call: {
        id: "commit-1",
        name: "git_commit",
        arguments: { message: "Agent change" },
      },
    };
    await e.store.save(run);
    const result = await e.decide(run.id, true);
    assert.equal(result.status, "running", result.error);
    assert.equal(await g(["show", "HEAD:a.txt"]), "agent edit");
    assert.match(
      await g(["diff", "--cached", "--", "b.txt"]),
      /user staged edit/,
    );
    assert.equal(await g(["show", "HEAD:b.txt"]), "original");
  } finally {
    await f.cleanup();
  }
});
