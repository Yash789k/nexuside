import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { docker, runBrowser, SANDBOX_IMAGE } from "../src/core/sandbox";
test("sandbox browser visits an allowlisted public page and captures each action", async () => {
  const r = await runBrowser(
    { url: "https://example.com", actions: [{ type: "wait", selector: "h1" }] },
    ["example.com"],
  );
  assert.equal(r.title, "Example Domain");
  assert.match(r.text, /Example Domain/);
  assert.ok(r.screenshot.length > 100);
  assert.ok(r.actions[0].screenshot.length > 100);
});
test("unapproved domains and protocols are refused before execution", async () => {
  await assert.rejects(
    runBrowser({ url: "https://example.net", actions: [] }, ["example.com"]),
    /allowlist/,
  );
  await assert.rejects(
    runBrowser({ url: "http://example.com", actions: [] }, ["example.com"]),
    /HTTPS/,
  );
});
test("internal Docker network has no direct public internet route", async () => {
  const name = `nexus-isolation-test-${randomUUID().slice(0, 8)}`;
  const net = await docker(["network", "create", "--internal", name]);
  assert.equal(net.exitCode, 0, net.output);
  try {
    const r = await docker([
      "run",
      "--rm",
      "--network",
      name,
      SANDBOX_IMAGE,
      "node",
      "-e",
      "fetch('https://example.com',{signal:AbortSignal.timeout(2500)}).then(()=>{console.log('EGRESS');process.exitCode=1}).catch(()=>console.log('BLOCKED'))",
    ]);
    assert.equal(r.exitCode, 0, r.output);
    assert.match(r.output, /BLOCKED/);
  } finally {
    await docker(["network", "rm", name]);
  }
});
