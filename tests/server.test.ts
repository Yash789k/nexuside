import test from "node:test";
import { request as httpRequest } from "node:http";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Workspace } from "../src/core/workspace";
import { Service } from "../src/server/service";
import { serve } from "../src/server/http";
test("loopback HTTP server requires a token and same origin; real demo can be reviewed through API", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexus-http-"));
  const web = path.join(root, "web");
  await mkdir(web);
  await writeFile(path.join(web, "index.html"), "<h1>Nexus</h1>");
  const s = await serve(new Service(await Workspace.open(root)), web, 0);
  const base = s.url.split("/#")[0];
  const request = (
    action: string,
    data: unknown = {},
    headers: Record<string, string> = {},
  ) =>
    fetch(`${base}/api/${action}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${s.token}`,
        ...headers,
      },
      body: JSON.stringify(data),
    });
  try {
    assert.equal((await fetch(`${base}/`)).status, 200);
    assert.equal(
      (await request("state", {}, { Authorization: "bad" })).status,
      401,
    );
    assert.equal(
      (await request("state", {}, { Origin: "https://evil.example" })).status,
      403,
    );
    const forged = await new Promise<number>((resolve) => {
      const req = httpRequest(
        base + "/",
        { headers: { Host: "evil.example" } },
        (res) => {
          resolve(res.statusCode!);
          res.resume();
        },
      );
      req.end();
    });
    assert.equal(forged, 403);
    const run = (await (
      await request("start", { prompt: "Fibonacci", model: "demo" })
    ).json()) as any;
    let state: any;
    for (let i = 0; i < 50; i++) {
      state = await (await request("run", { id: run.id })).json();
      if (state.status === "awaiting_approval") break;
      await new Promise((r) => setTimeout(r, 30));
    }
    assert.equal(state.pending.kind, "edits");
    assert.equal((await request("file", { path: "../escape" })).status, 400);
    assert.equal(
      (await request("decision", { id: run.id, approved: false })).status,
      200,
    );
    for (let i = 0; i < 50; i++) {
      const end = (await (await request("run", { id: run.id })).json()) as any;
      if (end.status === "completed") break;
      await new Promise((r) => setTimeout(r, 30));
    }
  } finally {
    await new Promise<void>((r) => s.server.close(() => r()));
    await rm(root, { recursive: true, force: true });
  }
});
