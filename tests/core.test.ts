import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  symlink,
  link,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Workspace } from "../src/core/workspace";
import { Store } from "../src/core/store";
import { Engine, approvalRevision } from "../src/core/engine";
import { defaults } from "../src/core/config";
import { route } from "../src/core/router";
import { evaluate } from "../src/core/evaluation";
import { randomUUID } from "node:crypto";
const fixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexus-test-"));
  const workspace = await Workspace.open(root);
  return {
    root,
    workspace,
    cleanup: () => rm(root, { recursive: true, force: true }),
  };
};
test("workspace rejects traversal, credential paths, Windows aliases and links", async () => {
  const f = await fixture();
  try {
    for (const p of [
      "../escape",
      "/etc/passwd",
      "a/../../x",
      ".env",
      ".git/config",
      "a/.env.local",
      "C:/outside",
      "a\\..\\outside",
      "foo:stream",
      "nul.txt",
      ".NEXUS/data",
      ".GIT/config",
      "x.",
    ])
      await assert.rejects(f.workspace.resolve(p), p);
    await writeFile(path.join(f.root, "ok.txt"), "safe");
    await symlink(path.join(f.root, "ok.txt"), path.join(f.root, "shortcut"));
    await assert.rejects(f.workspace.read("shortcut"), /links/);
    await link(path.join(f.root, "ok.txt"), path.join(f.root, "hard"));
    await assert.rejects(f.workspace.read("hard"), /Hard-linked/);
  } finally {
    await f.cleanup();
  }
});
test("workspace lists and searches only visible text files", async () => {
  const f = await fixture();
  try {
    await mkdir(path.join(f.root, "src"));
    await writeFile(path.join(f.root, "src/code.ts"), "one\nhello world");
    await writeFile(path.join(f.root, ".env"), "secret");
    await mkdir(path.join(f.root, "node_modules"));
    await writeFile(path.join(f.root, "node_modules/pkg"), "hello");
    assert.deepEqual(await f.workspace.list(), ["src/code.ts"]);
    assert.deepEqual(await f.workspace.search("HELLO"), [
      { path: "src/code.ts", line: 2, text: "hello world" },
    ]);
  } finally {
    await f.cleanup();
  }
});
test("multi-file approval refuses stale edits before applying any file", async () => {
  const f = await fixture();
  try {
    await writeFile(path.join(f.root, "a.txt"), "a");
    await writeFile(path.join(f.root, "b.txt"), "b");
    const edits = await f.workspace.stage([
      { path: "a.txt", content: "new a" },
      { path: "b.txt", content: "new b" },
    ]);
    await writeFile(path.join(f.root, "b.txt"), "user edit");
    await assert.rejects(f.workspace.apply(edits), /Conflict/);
    assert.equal(await f.workspace.read("a.txt"), "a");
    assert.equal(await f.workspace.read("b.txt"), "user edit");
    await assert.rejects(
      f.workspace.stage([
        { path: "a.txt", content: "x" },
        { path: "A.txt", content: "y" },
      ]),
      /Duplicate/,
    );
  } finally {
    await f.cleanup();
  }
});
test("router selects economical and quality tiers, honors capabilities and never silently chooses demo", async () => {
  const c = structuredClone(defaults);
  const key = async () => "test-credential";
  const simple = await route(
    "Explain a function",
    "economy",
    "auto",
    [],
    c,
    key,
  );
  assert.equal(simple.modelId, "openrouter-coder");
  const complex = await route(
    "Refactor the authentication architecture",
    "quality",
    "auto",
    [],
    c,
    key,
  );
  assert.equal(c.models.find((m) => m.id === complex.modelId)?.tier, 3);
  const video = await route(
    "Describe this video",
    "balanced",
    "auto",
    [{ name: "clip.mp4", mime: "video/mp4", data: "AA==" }],
    c,
    key,
  );
  assert.equal(video.modelId, "gemini");
  await assert.rejects(
    route("Write code", "balanced", "auto", [], c, async () => undefined),
    /Configure/,
  );
  assert.equal(
    (await route("demo", "balanced", "demo", [], c, async () => undefined))
      .modelId,
    "demo",
  );
});
test("trace chain detects edits and redacts token-like secrets", async () => {
  const f = await fixture();
  try {
    const store = new Store(f.workspace),
      id = randomUUID();
    await store.trace(id, "start", {
      message: "Bearer abcdefghijklmnopqrstuvwxyz",
    });
    await store.trace(id, "end", { ok: true });
    assert.equal(await store.verify(id), true);
    const p = await f.workspace.resolve(`.nexus/traces/${id}.jsonl`, true);
    const content = await readFile(p, "utf8");
    assert.ok(!content.includes("abcdefghijklmnopqrstuvwxyz"));
    await writeFile(p, content.replace('"ok":true', '"ok":false'));
    assert.equal(await store.verify(id), false);
  } finally {
    await f.cleanup();
  }
});
test("offline agent completes plan, review, real host tests and evaluation end to end", async () => {
  const f = await fixture();
  try {
    const config = {
      ...structuredClone(defaults),
      testRunner: "host" as const,
    };
    const e = new Engine(f.workspace);
    let run = await e.create(
      { prompt: "Add Fibonacci with tests", model: "demo" },
      config,
    );
    run = await e.drive(run.id);
    assert.equal(run.status, "awaiting_approval");
    assert.equal(run.pending?.kind, "edits");
    await assert.rejects(readFile(path.join(f.root, "src/fibonacci.mjs")));
    run = await e.decide(run.id, true, approvalRevision(await e.store.get(run.id)));
    run = await e.drive(run.id);
    assert.equal(run.pending?.kind, "tests");
    run = await e.decide(run.id, true, approvalRevision(await e.store.get(run.id)));
    run = await e.drive(run.id);
    assert.equal(run.status, "completed");
    assert.equal(run.tests[0].exitCode, 0, run.tests[0].output);
    assert.match(run.tests[0].output, /pass 3/);
    assert.equal(
      (await f.workspace.read("src/fibonacci.mjs")).includes("export function"),
      true,
    );
    const result = evaluate(
      run,
      await e.store.events(run.id),
      await e.store.verify(run.id),
    );
    assert.equal(result.verified, true);
    assert.equal(result.score, 100);
  } finally {
    await f.cleanup();
  }
});
test("rejecting staged edits leaves workspace unchanged and produces no fabricated verification", async () => {
  const f = await fixture();
  try {
    const e = new Engine(f.workspace);
    let r = await e.create(
      { prompt: "Fibonacci", model: "demo" },
      structuredClone(defaults),
    );
    r = await e.drive(r.id);
    r = await e.decide(r.id, false, approvalRevision(await e.store.get(r.id)));
    r = await e.drive(r.id);
    assert.equal(r.status, "completed");
    assert.equal(r.changes.length, 0);
    assert.equal(r.tests.length, 0);
    assert.equal(evaluate(r, await e.store.events(r.id), true).verified, false);
    assert.deepEqual(await f.workspace.list(), []);
  } finally {
    await f.cleanup();
  }
});
test("cancelled approval cannot be replayed", async () => {
  const f = await fixture();
  try {
    const e = new Engine(f.workspace);
    let r = await e.create(
      { prompt: "Fibonacci", model: "demo" },
      structuredClone(defaults),
    );
    await e.drive(r.id);
    const revision = approvalRevision(await e.store.get(r.id));
    await e.cancel(r.id);
    await assert.rejects(e.decide(r.id, true, revision), /not waiting/);
    assert.deepEqual(await f.workspace.list(), []);
  } finally {
    await f.cleanup();
  }
});
test("offline mode fails honestly for unsupported work", async () => {
  const f = await fixture();
  try {
    const e = new Engine(f.workspace);
    const r = await e.create(
      { prompt: "Build a CRM", model: "demo" },
      structuredClone(defaults),
    );
    const result = await e.drive(r.id);
    assert.equal(result.status, "failed");
    assert.match(result.error!, /only the Fibonacci/);
  } finally {
    await f.cleanup();
  }
});
