import { mkdir, readFile, writeFile, rm, lstat } from "node:fs/promises";
import path from "node:path";

/** Shared by manual saves, file operations and approved agent writes, across clients/processes. */
export async function fileTransaction<T>(
  root: string,
  operation: () => Promise<T>,
): Promise<T> {
  const dir = path.join(root, ".nexus", "files.lock");
  await mkdir(path.dirname(dir), { recursive: true });
  if ((await lstat(path.dirname(dir))).isSymbolicLink())
    throw new Error("Symbolic links are outside the workspace policy");
  const started = Date.now();
  while (true) {
    try {
      await mkdir(dir);
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      try {
        const owner = Number(await readFile(path.join(dir, "pid"), "utf8"));
        if (owner > 0) {
          try {
            process.kill(owner, 0);
          } catch (e) {
            if ((e as NodeJS.ErrnoException).code === "ESRCH") {
              const reclaim = dir + ".reclaim";
              try {
                await mkdir(reclaim);
                try {
                  // Recheck while holding the recovery guard: another client may already own a new lock.
                  const current = Number(
                    await readFile(path.join(dir, "pid"), "utf8"),
                  );
                  let dead = false;
                  try {
                    process.kill(current, 0);
                  } catch (error) {
                    dead = (error as NodeJS.ErrnoException).code === "ESRCH";
                  }
                  if (dead) await rm(dir, { recursive: true, force: true });
                } finally {
                  await rm(reclaim, { recursive: true, force: true });
                }
              } catch (error) {
                if (
                  !["EEXIST", "ENOENT"].includes(
                    (error as NodeJS.ErrnoException).code ?? "",
                  )
                )
                  throw error;
              }
              continue;
            }
          }
        }
      } catch {
        /* The owner may still be writing its pid. Never steal a live lock. */
      }
      if (Date.now() - started > 10_000)
        throw new Error(
          "Workspace writes are busy. Retry after the current save finishes.",
        );
      await new Promise((r) => setTimeout(r, 20));
    }
  }
  try {
    await writeFile(path.join(dir, "pid"), String(process.pid));
    return await operation();
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}
