import test from "node:test";
import assert from "node:assert/strict";
import { retryFileReplacement } from "../src/core/atomic";
test("atomic replacement retries transient Windows locks, with bounded delays and no destructive fallback", async () => {
  let attempts = 0;
  const pauses: number[] = [];
  await retryFileReplacement(
    async () => {
      if (++attempts < 4)
        throw Object.assign(new Error("locked"), { code: "EPERM" });
    },
    "win32",
    async (ms) => {
      pauses.push(ms);
    },
  );
  assert.equal(attempts, 4);
  assert.deepEqual(pauses, [25, 50, 100]);
  attempts = 0;
  const denied = Object.assign(new Error("denied"), { code: "EACCES" });
  await assert.rejects(
    retryFileReplacement(
      async () => {
        attempts++;
        throw denied;
      },
      "win32",
      async () => {},
    ),
    (error) => error === denied,
  );
  assert.equal(attempts, 8);
});
test("atomic replacement preserves non-Windows permission errors and non-transient Windows errors", async () => {
  for (const [platform, code] of [
    ["darwin", "EPERM"],
    ["linux", "EACCES"],
    ["win32", "ENOENT"],
  ] as const) {
    let calls = 0;
    await assert.rejects(
      retryFileReplacement(
        async () => {
          calls++;
          throw Object.assign(new Error(code), { code });
        },
        platform,
        async () => {
          assert.fail("unexpected retry");
        },
      ),
    );
    assert.equal(calls, 1);
  }
});
