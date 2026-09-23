import test from "node:test";
import assert from "node:assert/strict";
import {
  mkdtemp,
  writeFile,
  mkdir,
  readFile,
  rm,
  realpath,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { defaults } from "../src/core/config";
const cli = path.resolve(process.env.NEXUS_CLI ?? "dist/cli.cjs");
function launch(args: string[], env: NodeJS.ProcessEnv) {
  const child = spawn(process.execPath, [cli, ...args], {
    env,
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "",
    stderr = "";
  child.stdout.on("data", (d) => (stdout += d));
  child.stderr.on("data", (d) => (stderr += d));
  const result = new Promise<{
    code: number | null;
    stdout: string;
    stderr: string;
  }>((resolve) =>
    child.on("close", (code) => resolve({ code, stdout, stderr })),
  );
  return { child, result };
}
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "nexus cli 空間 ")),
    workspace = path.join(root, "working files");
  await mkdir(workspace);
  const env = { ...process.env, NEXUS_CONFIG: path.join(root, "config.json") };
  await writeFile(
    env.NEXUS_CONFIG,
    JSON.stringify({ ...defaults, testRunner: "host" }),
  );
  return {
    root,
    workspace,
    env,
    run: (args: string[]) => launch(["-w", workspace, ...args], env).result,
    close: () => rm(root, { recursive: true, force: true }),
  };
}
test("C01 JSON approval, stale replay, cancel, resume and trace on paths with spaces/Unicode", async () => {
  const f = await fixture();
  try {
    const initial = await f.run([
      "run",
      "Fibonacci",
      "--model",
      "demo",
      "--json",
    ]);
    assert.equal(initial.code, 0, initial.stderr);
    const r = JSON.parse(initial.stdout);
    assert.equal(r.status, "awaiting_approval");
    assert.equal(r.pending.revision.length, 64);
    const applied = await f.run([
      "approve",
      r.id,
      "--revision",
      r.pending.revision,
      "--json",
    ]);
    const b = JSON.parse(applied.stdout);
    assert.equal(b.pending.kind, "tests");
    const stale = await f.run([
      "approve",
      r.id,
      "--revision",
      r.pending.revision,
      "--json",
    ]);
    assert.equal(stale.code, 1);
    assert.match(JSON.parse(stale.stdout).error, /stale/);
    const rejected = JSON.parse(
      (
        await f.run([
          "approve",
          r.id,
          "--revision",
          b.pending.revision,
          "--reject",
          "--json",
        ])
      ).stdout,
    );
    assert.equal(rejected.status, "completed");
    assert.equal(rejected.tests.length, 0);
    assert.equal((await f.run(["trace", r.id, "--verify"])).code, 0);
    const resumed = JSON.parse(
      (await f.run(["resume", r.id, "--json"])).stdout,
    );
    assert.equal(resumed.status, "completed");
    const history = JSON.parse((await f.run(["runs", "--json"])).stdout);
    assert.equal(history.length, 1);
  } finally {
    await f.close();
  }
});
test("C02 offline host walkthrough completes from installed CLI; recovery command quotes workspace", async () => {
  const f = await fixture();
  try {
    const demoPath = path.join(f.root, "demo 空間");
    const result = await f.run(["demo", demoPath, "--yes", "--host"]);
    assert.equal(result.code, 0, result.stderr);
    assert.match(result.stdout, /COMPLETED/);
    assert.ok(
      (
        await readFile(path.join(demoPath, "src", "fibonacci.mjs"), "utf8")
      ).includes("fibonacci"),
    );
    assert.ok(result.stdout.includes(await realpath(demoPath)), result.stdout);
  } finally {
    await f.close();
  }
});
test("C03 invalid flags, attachment boundaries and unknown model return valid error JSON with nonzero status", async () => {
  const f = await fixture();
  try {
    for (const args of [
      ["run", "hello", "--mode", "wrong", "--json"],
      ["run", "hello", "--model", "missing-model", "--json"],
      ["run", "hello", "--attach", "missing.png", "--json"],
      ["run", "hello", "--unknown", "--json"],
    ]) {
      const r = await f.run(args);
      assert.equal(r.code, 1);
      const data = JSON.parse(r.stdout);
      assert.ok(data.error || data.status === "failed");
    }
  } finally {
    await f.close();
  }
});
test(`C04 repeated media flags reach a local provider; ${process.platform === "win32" ? "cancel command stops the active run" : "SIGINT records cancellation and exits 130"}`, async () => {
  const f = await fixture();
  let arrived!: () => void;
  const started = new Promise<void>((r) => (arrived = r));
  let requestBody: any;
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const c of req) body += c;
    requestBody = JSON.parse(body);
    arrived();
    const timer = setTimeout(
      () =>
        res.end(
          JSON.stringify({ choices: [{ message: { content: "late" } }] }),
        ),
      30000,
    );
    res.on("close", () => clearTimeout(timer));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  try {
    const model = {
      ...defaults.models.find((m) => m.provider === "openrouter")!,
      id: "local",
      keyEnv: undefined,
      baseUrl: `http://127.0.0.1:${(server.address() as any).port}`,
      capabilities: ["text", "image", "audio", "video"],
    };
    await writeFile(
      f.env.NEXUS_CONFIG,
      JSON.stringify({ ...defaults, models: [model] }),
    );
    await writeFile(
      path.join(f.workspace, "image 空間.png"),
      Buffer.from([1, 2, 3]),
    );
    await writeFile(
      path.join(f.workspace, "sound space.wav"),
      Buffer.from([1, 2, 3]),
    );
    const p = launch(
      [
        "-w",
        f.workspace,
        "run",
        "SLOW_FIXTURE",
        "--model",
        "local",
        "--attach",
        "image 空間.png",
        "--attach",
        "sound space.wav",
        "--json",
      ],
      f.env,
    );
    await started;
    assert.ok(JSON.stringify(requestBody).includes("input_audio"));
    assert.ok(JSON.stringify(requestBody).includes("image_url"));
    // Node's child.kill('SIGINT') uses forced termination on Windows; it does
    // not simulate Ctrl+C. Exercise the real cross-process cancel command there.
    // Native Windows console Ctrl+C still requires a ConPTY/console harness.
    if (process.platform === "win32") {
      const listed = await f.run(["runs", "--json"]);
      assert.equal(listed.code, 0, listed.stderr);
      const id = JSON.parse(listed.stdout).find(
        (r: any) => r.prompt === "SLOW_FIXTURE",
      ).id;
      const cancelled = await f.run(["cancel", id]);
      assert.equal(cancelled.code, 0, cancelled.stderr);
    } else p.child.kill("SIGINT");
    const end = await p.result;
    assert.equal(end.code, process.platform === "win32" ? 0 : 130, end.stderr);
    assert.equal(JSON.parse(end.stdout).status, "cancelled");
  } finally {
    server.closeAllConnections();
    await new Promise<void>((r) => server.close(() => r()));
    await f.close();
  }
});
