import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  rm,
  writeFile,
  readFile,
  mkdir,
  stat,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Workspace } from "../src/core/workspace";
import { Engine, approvalRevision } from "../src/core/engine";
import { defaults } from "../src/core/config";
const fixture = async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexus-qa-"));
  return {
    root,
    w: await Workspace.open(root),
    close: () => rm(root, { recursive: true, force: true }),
  };
};
test("Q01 delayed action A approval cannot execute pending action B or damage its state", async () => {
  const f = await fixture();
  try {
    const e = new Engine(f.w),
      second = new Engine(await Workspace.open(f.root));
    let r = await e.create(
      { prompt: "Fibonacci", model: "demo" },
      { ...structuredClone(defaults), testRunner: "host" },
    );
    r = await e.drive(r.id);
    const a = approvalRevision(r);
    await e.decide(r.id, true, a);
    r = await e.drive(r.id);
    assert.equal(r.pending?.kind, "tests");
    const b = approvalRevision(r);
    assert.notEqual(a, b);
    await assert.rejects(second.decide(r.id, true, a), /stale/);
    r = await e.store.get(r.id);
    assert.equal(r.status, "awaiting_approval");
    assert.equal(r.tests.length, 0);
    assert.equal(approvalRevision(r), b);
    await e.decide(r.id, false, b);
    await assert.rejects(second.decide(r.id, true, b), /not waiting/);
  } finally {
    await f.close();
  }
});
test("Q02 two clients racing the same review execute one decision", async () => {
  const f = await fixture();
  try {
    const e = new Engine(f.w),
      second = new Engine(await Workspace.open(f.root));
    let r = await e.create(
      { prompt: "Fibonacci", model: "demo" },
      structuredClone(defaults),
    );
    r = await e.drive(r.id);
    const revision = approvalRevision(r);
    const attempts = await Promise.allSettled([
      e.decide(r.id, true, revision),
      second.decide(r.id, false, revision),
    ]);
    assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
    const events = await e.store.events(r.id);
    assert.equal(events.filter((e) => e.type === "approval").length, 1);
    assert.equal(await e.store.verify(r.id), true);
  } finally {
    await f.close();
  }
});
test("Q03 concurrent saves and agent writes compare inside the same transaction; repeated save is a no-op", async () => {
  const f = await fixture();
  try {
    await f.w.save("space ü.txt", null, "first");
    await f.w.save("space ü.txt", "first", "first");
    const staged = await f.w.stage([{ path: "space ü.txt", content: "agent" }]);
    const second = await Workspace.open(f.root);
    const attempts = await Promise.allSettled([
      f.w.apply(staged),
      second.save("space ü.txt", "first", "manual"),
    ]);
    assert.equal(attempts.filter((r) => r.status === "fulfilled").length, 1);
    assert.ok(["agent", "manual"].includes(await f.w.read("space ü.txt")));
    await assert.rejects(
      f.w.save("space ü.txt", "first", "overwrite"),
      /Conflict/,
    );
  } finally {
    await f.close();
  }
});
test("Q04 file operations reject stale revision, duplicate targets and unsafe nested files, with recoverable deletion", async () => {
  const f = await fixture();
  try {
    await f.w.fileOperation({ kind: "folder", path: "資料" });
    await f.w.save("資料/a.txt", null, "a");
    let revision = await f.w.fileRevision("資料");
    await f.w.save("資料/b.txt", null, "b");
    await assert.rejects(
      f.w.fileOperation({ kind: "delete", path: "資料", revision }),
      /changed/,
    );
    revision = await f.w.fileRevision("資料");
    await f.w.fileOperation({
      kind: "rename",
      path: "資料",
      target: "new folder",
      revision,
    });
    const result = await f.w.fileOperation({
      kind: "delete",
      path: "new folder",
      revision: await f.w.fileRevision("new folder"),
    });
    assert.equal(await f.w.current("new folder/a.txt"), null);
    await f.w.restore(result.trash!);
    assert.equal(await f.w.read("new folder/b.txt"), "b");
    await writeFile(path.join(f.root, "new folder", ".env"), "SECRET");
    await assert.rejects(f.w.fileRevision("new folder"), /Sensitive/);
  } finally {
    await f.close();
  }
});
test("Q05 text byte limits, binary rejection, index truncation and file permissions are explicit", async () => {
  const f = await fixture();
  try {
    await assert.rejects(
      f.w.save("large.txt", null, "😀".repeat(128001)),
      /500 KB/,
    );
    await writeFile(
      path.join(f.root, "invalid-utf8.txt"),
      Buffer.from([255, 254, 128]),
    );
    await assert.rejects(f.w.read("invalid-utf8.txt"), /UTF-8/);
    await f.w.save("limit.txt", null, "a".repeat(512000));
    assert.equal((await f.w.read("limit.txt")).length, 512000);
    await assert.rejects(f.w.save("binary", null, "\0"), /text/);
    await writeFile(path.join(f.root, "exec.sh"), "a", { mode: 0o755 });
    await f.w.save("exec.sh", "a", "b");
    if (process.platform !== "win32")
      assert.equal(
        (await stat(path.join(f.root, "exec.sh"))).mode & 0o777,
        0o755,
      );
    await mkdir(path.join(f.root, "many"));
    await Promise.all(
      Array.from({ length: 1210 }, (_, i) =>
        writeFile(path.join(f.root, "many", `${i}.txt`), "x"),
      ),
    );
    const index = await f.w.index();
    assert.equal(index.limited, true);
    assert.ok(index.files.length <= 1200);
  } finally {
    await f.close();
  }
});
test("Q06 duplicate submissions have one persisted run across service clients", async () => {
  const f = await fixture();
  const old = process.env.NEXUS_CONFIG;
  try {
    process.env.NEXUS_CONFIG = path.join(f.root, "config.json");
    await writeFile(process.env.NEXUS_CONFIG, JSON.stringify(defaults));
    const { Service } = await import("../src/server/service");
    const one = new Service(f.w),
      two = new Service(await Workspace.open(f.root));
    const requestId = crypto.randomUUID();
    const input = { prompt: "Fibonacci", model: "demo", requestId };
    const [a, b] = (await Promise.all([
      one.request("start", input),
      two.request("start", input),
    ])) as any[];
    assert.equal(a.id, b.id);
    for (let i = 0; i < 100; i++) {
      const run = await one.engine.store.get(a.id);
      if (run.status === "awaiting_approval") break;
      await new Promise((r) => setTimeout(r, 20));
    }
    assert.equal((await one.engine.store.list()).length, 1);
    assert.equal(
      (await one.engine.store.get(a.id)).status,
      "awaiting_approval",
    );
  } finally {
    if (old) process.env.NEXUS_CONFIG = old;
    else delete process.env.NEXUS_CONFIG;
    await f.close();
  }
});
test("Q07 interrupted multi-file journal recovers atomically and preserves conflicting external edits", async () => {
  const f = await fixture();
  try {
    await f.w.save("one.txt", null, "original");
    await f.w.save("two.txt", null, "original");
    const journal = `.nexus/transactions/${crypto.randomUUID()}.json`,
      changes = [
        { path: "one.txt", before: "original", after: "approved" },
        { path: "two.txt", before: "original", after: "approved" },
      ];
    await f.w.atomicWrite(journal, JSON.stringify(changes), true);
    await f.w.atomicWrite("one.txt", "approved");
    await f.w.save("other.txt", null, "safe");
    assert.equal(await f.w.read("one.txt"), "original");
    assert.equal(await f.w.read("two.txt"), "original");
    await f.w.atomicWrite(journal, JSON.stringify(changes), true);
    await f.w.atomicWrite("one.txt", "external");
    await assert.rejects(
      f.w.save("other.txt", "safe", "next"),
      /Interrupted save conflicts/,
    );
    assert.equal(await f.w.read("one.txt"), "external");
    assert.equal(await f.w.read("other.txt"), "safe");
    assert.ok(await readFile(path.join(f.root, journal)));
  } finally {
    await f.close();
  }
});
test("Q08 IDE requests block execution tools and retain their configuration snapshot", async () => {
  const f = await fixture();
  try {
    const e = new Engine(f.w),
      config = structuredClone(defaults);
    let r = await e.create(
      { prompt: "Explain", model: "demo", mode: "ide" },
      config,
    );
    config.testRunner = "host";
    r.queuedCalls = [
      { id: "tests", name: "run_tests", arguments: { target: "node" } },
      {
        id: "browser",
        name: "browser",
        arguments: { url: "https://example.com", actions: [] },
      },
    ];
    await e.store.save(r);
    r = await e.drive(r.id);
    assert.equal(r.mode, "ide");
    assert.equal(r.config.testRunner, "docker");
    assert.equal(r.tests.length, 0);
    assert.equal(r.pending, undefined);
    assert.equal(
      (await e.store.events(r.id)).filter((e) => e.type === "policy_block")
        .length,
      2,
    );
  } finally {
    await f.close();
  }
});
test("Q09 media limits count decoded bytes; invalid base64 and six attachments fail before provider access", async () => {
  const f = await fixture();
  try {
    const e = new Engine(f.w),
      a = {
        name: "image.png",
        mime: "image/png",
        data: Buffer.alloc(10_000_001).toString("base64"),
      };
    await assert.rejects(
      e.create(
        { prompt: "test", attachments: [a, a] },
        structuredClone(defaults),
      ),
      /20 MB/,
    );
    await assert.rejects(
      e.create(
        { prompt: "test", attachments: [{ ...a, data: "a" }] },
        structuredClone(defaults),
      ),
    );
    await assert.rejects(
      e.create(
        {
          prompt: "test",
          attachments: Array.from({ length: 6 }, () => ({
            ...a,
            data: "YQ==",
          })),
        },
        structuredClone(defaults),
      ),
    );
    assert.equal((await e.store.list()).length, 0);
  } finally {
    await f.close();
  }
});
