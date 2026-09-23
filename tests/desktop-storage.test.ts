import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { CredentialVault } from "../src/desktop/storage";
// The OS cryptography boundary is injected; the desktop integration suite
// separately checks the real Electron safeStorage result on the running OS.
const encrypt = (s: string) => Buffer.from(s.split("").reverse().join(""));
const decrypt = (b: Buffer) => b.toString().split("").reverse().join("");
test("desktop vault serializes concurrent updates, restores encrypted entries and removes keys", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nexus-vault-"));
  try {
    const file = path.join(dir, "keys.json");
    const first = new CredentialVault(file, true, encrypt, decrypt);
    await first.load();
    await Promise.all([
      first.set("OPENROUTER_API_KEY", "fixture-router-secret"),
      first.set("OPENAI_API_KEY", "fixture-openai-secret"),
    ]);
    assert.ok(!(await readFile(file, "utf8")).includes("fixture-"));
    const next = new CredentialVault(file, true, encrypt, decrypt);
    await next.load();
    assert.equal(await next.get("OPENROUTER_API_KEY"), "fixture-router-secret");
    assert.equal(await next.get("OPENAI_API_KEY"), "fixture-openai-secret");
    await next.set("OPENAI_API_KEY", "fixture-session-after-disable");
    await next.useSessionOnly();
    assert.equal(
      await next.get("OPENAI_API_KEY"),
      "fixture-session-after-disable",
    );
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {});
    // Restore a persisted key to keep the independent removal check below.
    next.protectedStorage = true;
    await next.set("OPENAI_API_KEY", "fixture-openai-secret");
    await next.set("OPENROUTER_API_KEY", "");
    const final = new CredentialVault(file, true, encrypt, decrypt);
    await final.load();
    assert.equal(await final.get("OPENROUTER_API_KEY"), undefined);
    assert.equal(await final.get("OPENAI_API_KEY"), "fixture-openai-secret");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("desktop vault keeps keys in session memory when protected encryption is unavailable", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nexus-vault-memory-"));
  try {
    const file = path.join(dir, "keys.json");
    const vault = new CredentialVault(
      file,
      false,
      () => {
        throw new Error("must not encrypt");
      },
      decrypt,
    );
    await vault.load();
    await vault.set("OPENROUTER_API_KEY", "fixture-session-secret");
    assert.equal(
      await vault.get("OPENROUTER_API_KEY"),
      "fixture-session-secret",
    );
    assert.deepEqual(JSON.parse(await readFile(file, "utf8")), {});
    const next = new CredentialVault(file, false, encrypt, decrypt);
    await next.load();
    assert.equal(await next.get("OPENROUTER_API_KEY"), undefined);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
test("a locked credential store leaves saved keys intact and keeps project state readable", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "nexus-vault-locked-"));
  try {
    const file = path.join(dir, "keys.json");
    const saved = new CredentialVault(file, true, encrypt, decrypt);
    await saved.load();
    await saved.set("OPENROUTER_API_KEY", "fixture-persisted-key");
    const before = await readFile(file, "utf8");
    const locked = new CredentialVault(file, false, encrypt, decrypt);
    await locked.load();
    assert.equal(await locked.get("OPENROUTER_API_KEY"), undefined);
    assert.match(locked.warning, /locked or unavailable/);
    assert.equal(await readFile(file, "utf8"), before);
    const unlocked = new CredentialVault(file, true, encrypt, decrypt);
    await unlocked.load();
    assert.equal(
      await unlocked.get("OPENROUTER_API_KEY"),
      "fixture-persisted-key",
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
