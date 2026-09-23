import { spawn } from "node:child_process";
export const cleanEnv = () =>
  Object.fromEntries(
    Object.entries(process.env).filter(([k]) =>
      [
        "PATH",
        "SYSTEMROOT",
        "WINDIR",
        "TEMP",
        "TMP",
        "TMPDIR",
        "PATHEXT",
        "COMSPEC",
        "LANG",
      ].includes(k.toUpperCase()),
    ),
  ) as NodeJS.ProcessEnv;
export async function execFile(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    input?: string;
    timeout?: number;
    limit?: number;
    env?: NodeJS.ProcessEnv;
    signal?: AbortSignal;
  } = {},
) {
  return new Promise<{ exitCode: number; output: string; durationMs: number }>(
    (resolve, reject) => {
      const start = Date.now();
      let output = "";
      let exceeded = false;
      const child = spawn(command, args, {
        cwd: options.cwd,
        env: options.env ?? cleanEnv(),
        shell: false,
        windowsHide: true,
        stdio: ["pipe", "pipe", "pipe"],
        detached: process.platform !== "win32",
      });
      const stop = () => {
        try {
          if (process.platform === "win32") {
            const killer=spawn("taskkill",["/pid",String(child.pid),"/T","/F"],{shell:false,windowsHide:true,stdio:"ignore"});
            killer.on("error",()=>child.kill("SIGKILL"));
          }
          else process.kill(-child.pid!, "SIGKILL");
        } catch {}
      };
      const timer = setTimeout(() => {
        output += "\n[Timed out]";
        stop();
      }, options.timeout ?? 60_000);
      const onAbort = () => {
        output += "\n[Cancelled]";
        stop();
      };
      options.signal?.addEventListener("abort", onAbort, { once: true });
      const collect = (data: Buffer) => {
        if (output.length + data.length > (options.limit ?? 200_000)) {
          if (!exceeded) {
            output += "\n[Output limit reached]";
            exceeded = true;
            stop();
          }
        } else output += data.toString();
      };
      child.stdout.on("data", collect);
      child.stderr.on("data", collect);
      child.stdin.on("error", () => {});
      child.stdin.end(options.input);
      const cleanup = () => {
        clearTimeout(timer);
        options.signal?.removeEventListener("abort", onAbort);
      };
      child.on("error", (e) => {
        cleanup();
        reject(e);
      });
      child.on("close", (code) => {
        cleanup();
        resolve({
          exitCode: code ?? 1,
          output,
          durationMs: Date.now() - start,
        });
      });
      if (options.signal?.aborted) onAbort();
    },
  );
}
export async function git(root: string, args: string[], signal?: AbortSignal) {
  return execFile(
    "git",
    [
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.fsmonitor=false",
      ...(["diff", "show", "log"].includes(args[0])
        ? [args[0], "--no-ext-diff", "--no-textconv", ...args.slice(1)]
        : args),
    ],
    {
      cwd: root,
      signal,
      env: {
        ...cleanEnv(),
        HOME: process.env.HOME,
        USERPROFILE: process.env.USERPROFILE,
        GIT_CONFIG_NOSYSTEM: "1",
        GIT_TERMINAL_PROMPT: "0",
      },
    },
  );
}
