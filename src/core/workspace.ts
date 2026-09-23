import {
  realpath,
  lstat,
  readdir,
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import type { Change } from "./types";
const ignored = new Set([
  "node_modules",
  ".git",
  ".nexus",
  ".next",
  "dist",
  "build",
  ".venv",
  "venv",
  "__pycache__",
]);
export function sensitive(name: string) {
  return /(^\.env($|\.)|^\.npmrc$|^\.netrc$|^\.pypirc$|^\.ssh$|^\.aws$|^\.config$|^id_(rsa|ed25519)|\.(pem|key|p12|pfx)$|^(credentials|secrets)(\.|$))/i.test(
    name,
  );
}
export class Workspace {
  private constructor(public readonly root: string) {}
  static async open(root: string) {
    return new Workspace(await realpath(path.resolve(root)));
  }
  async resolve(relative: string, internal = false): Promise<string> {
    if (
      !relative ||
      relative.includes("\0") ||
      relative.includes("\\") ||
      path.isAbsolute(relative) ||
      /^[a-z]:/i.test(relative)
    )
      throw new Error("A relative workspace path is required");
    const parts = relative.split("/");
    if (
      parts.some(
        (p) =>
          !p ||
          p === ".." ||
          p === "." ||
          p.includes(":") ||
          p.endsWith(".") ||
          p.endsWith(" ") ||
          /^(CON|PRN|AUX|NUL|COM[0-9]|LPT[0-9])(\.|$)/i.test(p),
      )
    )
      throw new Error("Unsafe workspace path");
    if (
      parts.some(
        (p) =>
          p.toLowerCase() === ".git" ||
          (!internal && p.toLowerCase() === ".nexus") ||
          sensitive(p),
      )
    )
      throw new Error("Sensitive or internal path is blocked");
    let current = this.root;
    for (const part of parts) {
      current = path.join(current, part);
      try {
        const stat = await lstat(current);
        if (stat.isSymbolicLink())
          throw new Error("Symbolic links are outside the workspace policy");
        if (stat.nlink > 1 && stat.isFile())
          throw new Error("Hard-linked files are outside the workspace policy");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
    }
    return current;
  }
  async read(file: string) {
    const target = await this.resolve(file);
    const s = await lstat(target);
    if (!s.isFile() || s.size > 512_000)
      throw new Error("Only text files up to 500 KB may be read");
    const text = await readFile(target, "utf8");
    if (text.includes("\0")) throw new Error("Binary file is not supported");
    return text;
  }
  async list() {
    const files: string[] = [];
    const walk = async (dir: string, depth: number) => {
      if (depth > 12 || files.length >= 1200) return;
      for (const e of await readdir(path.join(this.root, dir), {
        withFileTypes: true,
      })) {
        if (ignored.has(e.name) || sensitive(e.name) || e.isSymbolicLink())
          continue;
        const rel = dir ? `${dir}/${e.name}` : e.name;
        if (e.isDirectory()) await walk(rel, depth + 1);
        else if (e.isFile()) files.push(rel);
        if (files.length >= 1200) break;
      }
    };
    await walk("", 0);
    return files.sort();
  }
  async stage(edits: { path: string; content: string }[]): Promise<Change[]> {
    if (!edits.length || edits.length > 30)
      throw new Error("Submit 1–30 file edits");
    const seen = new Set<string>();
    const out: Change[] = [];
    for (const e of edits) {
      const target = await this.resolve(e.path);
      const key = target.toLowerCase();
      if (seen.has(key)) throw new Error("Duplicate edit path");
      seen.add(key);
      if (Buffer.byteLength(e.content) > 512_000)
        throw new Error("Edit exceeds 500 KB");
      let before: string | null = null;
      try {
        before = await this.read(e.path);
      } catch (err) {
        if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
      }
      if (before === e.content) continue;
      out.push({
        path: e.path,
        before,
        after: e.content,
        diff: createTwoFilesPatch(
          e.path,
          e.path,
          before ?? "",
          e.content,
          "before",
          "proposed",
        ),
      });
    }
    if (!out.length)
      throw new Error(
        "The proposed contents already match the workspace. No file edits are needed.",
      );
    return out;
  }
  async apply(changes: Change[]) {
    // Check every preimage before changing any file. Never silently overwrite a user's newer edit.
    for (const c of changes) {
      let current: string | null = null;
      try {
        current = await this.read(c.path);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      if (current !== c.before)
        throw new Error(
          `Conflict: ${c.path} changed since the proposal. Start a new task.`,
        );
      await this.resolve(c.path);
    }
    const applied: Change[] = [];
    try {
      for (const c of changes) {
        await this.atomicWrite(c.path, c.after);
        applied.push(c);
      }
    } catch (e) {
      for (const c of applied.reverse()) {
        if (c.before === null) await unlink(await this.resolve(c.path));
        else await this.atomicWrite(c.path, c.before);
      }
      throw e;
    }
  }
  async atomicWrite(file: string, text: string, internal = false) {
    const dest = await this.resolve(file, internal);
    await mkdir(path.dirname(dest), { recursive: true });
    await this.resolve(file, internal);
    const tmp = dest + `.${randomUUID()}.tmp`;
    try {
      await writeFile(tmp, text, { flag: "wx", mode: 0o600 });
      await rename(tmp, dest);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }
  async search(query: string) {
    if (!query || query.length > 200)
      throw new Error("Search must contain 1–200 characters");
    const hits: { path: string; line: number; text: string }[] = [];
    for (const file of await this.list()) {
      try {
        const text = await this.read(file);
        text.split("\n").forEach((line, i) => {
          if (
            line.toLowerCase().includes(query.toLowerCase()) &&
            hits.length < 100
          )
            hits.push({ path: file, line: i + 1, text: line.slice(0, 300) });
        });
      } catch {}
      if (hits.length >= 100) break;
    }
    return hits;
  }
}
