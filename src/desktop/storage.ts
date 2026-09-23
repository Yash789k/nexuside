import { readFile, writeFile, unlink, mkdir } from "node:fs/promises";
import { replaceFile } from "../core/atomic";
import path from "node:path";
import { randomUUID } from "node:crypto";
export async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return fallback;
    throw new Error(
      `Cannot read ${path.basename(file)}. Restore a valid copy before continuing.`,
    );
  }
}
export async function writeJson(file: string, value: unknown) {
  await mkdir(path.dirname(file), { recursive: true });
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  try {
    await replaceFile(temporary, file);
  } finally {
    await unlink(temporary).catch(() => {});
  }
}
export class CredentialVault {
  warning = "";
  private entries: Record<string, string> = {};
  private memory = new Map<string, string>();
  private queue: Promise<unknown> = Promise.resolve();
  constructor(
    private file: string,
    public protectedStorage: boolean,
    private encrypt: (value: string) => Buffer | Promise<Buffer>,
    private decrypt: (value: Buffer) => string | Promise<string>,
  ) {}
  async load() {
    this.entries = await readJson(this.file, {});
  }
  useSessionOnly() {
    const pending = this.queue
      .catch(() => {})
      .then(async () => {
        await writeJson(this.file, {});
        this.entries = {};
        this.protectedStorage = false;
        this.warning = "";
      });
    this.queue = pending;
    return pending;
  }
  async get(env: string) {
    if (this.memory.has(env)) return this.memory.get(env) || undefined;
    const stored = this.entries[env];
    if (!stored) return undefined;
    if (!this.protectedStorage) {
      this.warning =
        "Saved keys are locked or unavailable. Unlock the system credential store and restart, or use a key for this session.";
      return undefined;
    }
    try {
      return await this.decrypt(Buffer.from(stored, "base64"));
    } catch {
      this.warning =
        "Saved keys are locked or unavailable. Unlock the system credential store or re-enter your provider key.";
      return undefined;
    }
  }
  set(env: string, value: string) {
    const pending = this.queue
      .catch(() => {})
      .then(async () => {
        const next = { ...this.entries };
        if (!value || !this.protectedStorage) delete next[env];
        else next[env] = (await this.encrypt(value)).toString("base64");
        // Without a protected OS store, never persist the provider credential.
        await writeJson(this.file, next);
        this.entries = next;
        this.memory.set(env, value);
        this.warning = "";
      });
    this.queue = pending;
    return pending;
  }
}
