import {
  realpath,
  lstat,
  readdir,
  readFile,
  writeFile,
  mkdir,
  rename,
  unlink,
  chmod,
} from "node:fs/promises";
import path from "node:path";
import { randomUUID, createHash } from "node:crypto";
import { createTwoFilesPatch } from "diff";
import type { Change } from "./types";
import { fileTransaction } from "./file-lock";
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
    const bytes = await readFile(target);
    let text: string;
    try {
      text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
        bytes,
      );
    } catch {
      throw new Error(
        "Unsupported text encoding or binary file. UTF-8 is required.",
      );
    }
    if (text.includes("\0")) throw new Error("Binary file is not supported");
    return text;
  }
  async index() {
    const files: string[] = [],
      directories: string[] = [];
    let limited = false,
      count = 0;
    const walk = async (dir: string, depth: number) => {
      if (depth > 12 || count >= 1200) {
        limited = true;
        return;
      }
      const entries = (
        await readdir(path.join(this.root, dir), { withFileTypes: true })
      ).sort((a, b) => a.name.localeCompare(b.name));
      for (const e of entries) {
        if (ignored.has(e.name) || sensitive(e.name) || e.isSymbolicLink())
          continue;
        if (count >= 1200) {
          limited = true;
          break;
        }
        const rel = dir ? `${dir}/${e.name}` : e.name;
        count++;
        if (e.isDirectory()) {
          directories.push(rel);
          await walk(rel, depth + 1);
        } else if (e.isFile()) files.push(rel);
      }
    };
    await walk("", 0);
    return {
      files: files.sort(),
      directories: directories.sort(),
      limited,
      limit: 1200,
      depth: 12,
    };
  }
  async list() {
    return (await this.index()).files;
  }
  async current(file: string) {
    try {
      return await this.read(file);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw e;
    }
  }
  private async transaction<T>(operation: () => Promise<T>): Promise<T> {
    return fileTransaction(this.root, async () => {
      await this.recoverWrites();
      return operation();
    });
  }
  private async recoverWrites() {
    const dir = await this.resolve(".nexus/transactions", true);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") return;
      throw e;
    }
    for (const name of names.filter((n) => /^[a-f0-9-]{36}\.json$/.test(n))) {
      const file = await this.resolve(`.nexus/transactions/${name}`, true);
      const changes = JSON.parse(await readFile(file, "utf8")) as Pick<
        Change,
        "path" | "before" | "after"
      >[];
      if (!Array.isArray(changes) || changes.length > 30)
        throw new Error("Invalid interrupted transaction journal");
      for (const c of changes) {
        const current = await this.current(c.path);
        if (current !== c.before && current !== c.after)
          throw new Error(
            `Interrupted save conflicts with ${c.path}. Your files and .nexus/transactions journal have been preserved for recovery.`,
          );
      }
      for (const c of [...changes].reverse())
        if ((await this.current(c.path)) !== c.before) {
          if (c.before === null) await unlink(await this.resolve(c.path));
          else await this.atomicWrite(c.path, c.before);
        }
      await unlink(file);
    }
  }
  async save(file: string, before: string | null, content: string) {
    if (Buffer.byteLength(content) > 512_000 || content.includes("\0"))
      throw new Error("Only text files up to 500 KB may be saved");
    return this.transaction(async () => {
      const current = await this.current(file);
      if (current !== before)
        throw new Error(
          `Conflict: ${file} changed externally. Compare or reload before saving.`,
        );
      if (current !== content) await this.atomicWrite(file, content);
      return { ok: true, content };
    });
  }
  async fileRevision(file: string) {
    const hash = createHash("sha256");
    let count = 0,
      bytes = 0;
    const walk = async (rel: string) => {
      const target = await this.resolve(rel),
        stat = await lstat(target);
      if (++count > 1200)
        throw new Error(
          "File operation exceeds 1200 entries. Use the host file manager.",
        );
      hash.update(rel).update(String(stat.mode));
      if (stat.isDirectory()) {
        for (const name of (await readdir(target)).sort())
          await walk(`${rel}/${name}`);
      } else {
        bytes += stat.size;
        if (bytes > 20_000_000)
          throw new Error(
            "File operation exceeds 20 MB. Use the host file manager.",
          );
        hash.update(await readFile(target));
      }
    };
    await walk(file);
    return hash.digest("hex");
  }
  async fileOperation(input: {
    kind: "folder" | "rename" | "delete";
    path: string;
    target?: string;
    revision?: string;
  }) {
    return this.transaction(async () => {
      const source = await this.resolve(input.path);
      if (input.kind === "folder") {
        await mkdir(path.dirname(source), { recursive: true });
        await mkdir(source);
        return { ok: true };
      }
      if ((await this.fileRevision(input.path)) !== input.revision)
        throw new Error("File or folder changed since review. Review again.");
      if (input.kind === "rename") {
        if (!input.target) throw new Error("A destination is required");
        const dest = await this.resolve(input.target);
        try {
          await lstat(dest);
          throw new Error("Destination already exists");
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
        }
        await mkdir(path.dirname(dest), { recursive: true });
        await rename(source, dest);
        return { ok: true };
      }
      const trash = `.nexus/trash/${randomUUID()}`;
      const dest = await this.resolve(`${trash}/content`, true);
      await mkdir(path.dirname(dest), { recursive: true });
      await writeFile(
        await this.resolve(`${trash}/manifest.json`, true),
        JSON.stringify({ path: input.path }),
        { mode: 0o600 },
      );
      await rename(source, dest);
      return { ok: true, trash };
    });
  }
  async restore(trash: string) {
    if (!/^\.nexus\/trash\/[a-f0-9-]{36}$/.test(trash))
      throw new Error("Invalid recovery item");
    return this.transaction(async () => {
      const manifest = JSON.parse(
        await readFile(
          await this.resolve(`${trash}/manifest.json`, true),
          "utf8",
        ),
      );
      const dest = await this.resolve(manifest.path);
      try {
        await lstat(dest);
        throw new Error("Destination exists; recovery will not overwrite it");
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await mkdir(path.dirname(dest), { recursive: true });
      await rename(await this.resolve(`${trash}/content`, true), dest);
      return { path: manifest.path };
    });
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
    return this.transaction(() => this.applyLocked(changes));
  }
  private async applyLocked(changes: Change[]) {
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
    const journal = `.nexus/transactions/${randomUUID()}.json`;
    await this.atomicWrite(
      journal,
      JSON.stringify(
        changes.map(({ path, before, after }) => ({ path, before, after })),
      ),
      true,
    );
    const applied: Change[] = [];
    try {
      for (const c of changes) {
        await this.atomicWrite(c.path, c.after);
        applied.push(c);
      }
      await unlink(await this.resolve(journal, true));
    } catch (e) {
      for (const c of applied.reverse()) {
        if ((await this.current(c.path)) !== c.after)
          throw new Error(
            `Rollback conflict: ${c.path}. Recovery journal preserved.`,
          );
        if (c.before === null) await unlink(await this.resolve(c.path));
        else await this.atomicWrite(c.path, c.before);
      }
      await unlink(await this.resolve(journal, true));
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
      try {
        await chmod(tmp, (await lstat(dest)).mode & 0o777);
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
      }
      await rename(tmp, dest);
    } finally {
      await unlink(tmp).catch(() => {});
    }
  }
  async search(query: string) {
    if (!query || query.length > 200)
      throw new Error("Search must contain 1–200 characters");
    const files = await this.list(),
      hits: { path: string; line: number; text: string }[] = [],
      needle = query.toLowerCase();
    // Bounded parallel reads keep large indexes responsive without unbounded file descriptors.
    for (
      let offset = 0;
      offset < files.length && hits.length < 100;
      offset += 16
    ) {
      const batch = await Promise.all(
        files.slice(offset, offset + 16).map(async (file) => {
          try {
            return { file, text: await this.read(file) };
          } catch {
            return undefined;
          }
        }),
      );
      for (const item of batch)
        if (item) {
          const lines = item.text.split("\n");
          for (let i = 0; i < lines.length && hits.length < 100; i++)
            if (lines[i].toLowerCase().includes(needle))
              hits.push({
                path: item.file,
                line: i + 1,
                text: lines[i].slice(0, 300),
              });
        }
    }
    return hits;
  }
}
