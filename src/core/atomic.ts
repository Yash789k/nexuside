import { rename } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

// Windows can briefly deny replacement while a reader/indexer holds the old
// file. Retry the atomic rename; never unlink the destination to make it pass.
export async function retryFileReplacement(
  operation: () => Promise<void>,
  platform: NodeJS.Platform = process.platform,
  pause: (ms: number) => Promise<unknown> = delay,
) {
  const backoff = [25, 50, 100, 200, 300, 400, 500];
  for (let attempt = 0; ; attempt++) {
    try {
      return await operation();
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (
        platform !== "win32" ||
        !["EPERM", "EACCES", "EBUSY"].includes(code ?? "") ||
        attempt >= backoff.length
      )
        throw error;
      await pause(backoff[attempt]);
    }
  }
}
export function replaceFile(source: string, destination: string) {
  return retryFileReplacement(() => rename(source, destination));
}
