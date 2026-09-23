import { mkdtemp, mkdir, writeFile, rm, chmod, lstat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { execFile, cleanEnv } from "./process";
import { Workspace } from "./workspace";
import type { Config, TestResult } from "./types";
import { browserSchema } from "./tools";
export const SANDBOX_IMAGE = "nexuside-sandbox:0.1.0";
const dockerEnv = () => ({
  ...cleanEnv(),
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  DOCKER_HOST: process.env.DOCKER_HOST,
  DOCKER_CONTEXT: process.env.DOCKER_CONTEXT,
});
export async function docker(
  args: string[],
  input?: string,
  timeout = 90_000,
  signal?: AbortSignal,
) {
  return execFile("docker", args, {
    input,
    timeout,
    env: dockerEnv(),
    limit: 4_000_000,
    signal,
  });
}
export async function requireDocker() {
  const r = await docker(
    ["info", "--format", "{{.ServerVersion}}"],
    undefined,
    10_000,
  );
  if (r.exitCode !== 0)
    throw new Error(
      "Docker is not running. Start Docker Desktop, or explicitly choose host tests in Settings.",
    );
}
export async function runTests(
  workspace: Workspace,
  target: "node" | "npm" | "pytest",
  runner: Config["testRunner"],
  signal?: AbortSignal,
): Promise<TestResult> {
  const commands = {
    node: ["node", "--test"],
    npm: [process.platform === "win32" ? "npm.cmd" : "npm", "test"],
    pytest: ["python3", "-m", "pytest", "-q"],
  };
  const command = commands[target];
  if (runner === "host") {
    // npm.cmd is a shell script on Windows; invoke npm's JS entry using the installed Node runtime instead.
    let executable = command[0],
      args = command.slice(1);
    if (process.platform === "win32" && target === "npm") {
      // In the extension host process.execPath is Code.exe, not node.exe.
      // Resolve npm from PATH and invoke its JS entry without a command shell.
      const located = await execFile("where.exe", ["npm.cmd"], { signal });
      let entry: string | undefined;
      for (const shim of located.output.trim().split(/\r?\n/)) {
        const candidate = path.join(
          path.dirname(shim),
          "node_modules/npm/bin/npm-cli.js",
        );
        if (
          await lstat(candidate)
            .then((s) => s.isFile())
            .catch(() => false)
        ) {
          entry = candidate;
          break;
        }
      }
      if (!entry)
        throw new Error(
          "npm was not found on PATH. Install Node.js 22 or later and restart VS Code.",
        );
      executable = "node";
      args = [entry, "test"];
    }
    if (process.platform === "win32" && target === "pytest")
      executable = "python";
    return {
      target,
      runner,
      ...(await execFile(executable, args, {
        cwd: workspace.root,
        signal,
        timeout: 120_000,
      })),
    };
  }
  await requireDocker();
  const stage = await mkdtemp(path.join(tmpdir(), "nexus-test-"));
  const name = `nexus-test-${randomUUID()}`;
  try {
    for (const file of await workspace.list()) {
      try {
        const data = await workspace.read(file);
        const dest = path.join(stage, file);
        await mkdir(path.dirname(dest), { recursive: true });
        await writeFile(dest, data, { mode: 0o644 });
      } catch {}
    }
    await chmod(stage, 0o755);
    const result = await docker(
      [
        "run",
        "--rm",
        "--name",
        name,
        "--network",
        "none",
        "--cap-drop=ALL",
        "--security-opt",
        "no-new-privileges",
        "--memory",
        "512m",
        "--cpus",
        "1",
        "--pids-limit",
        "128",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,nosuid,size=128m",
        "--user",
        `${process.getuid?.() ?? 1000}:${process.getgid?.() ?? 1000}`,
        "-v",
        `${stage}:/workspace:rw`,
        "-w",
        "/workspace",
        target === "pytest" ? SANDBOX_IMAGE : "node:22-alpine",
        ...commands[target].map((c) => (c === "npm.cmd" ? "npm" : c)),
      ],
      undefined,
      120_000,
      signal,
    );
    return { target, runner, ...result };
  } finally {
    await docker(["rm", "-f", name], undefined, 10_000).catch(() => {});
    await rm(stage, { recursive: true, force: true });
  }
}
export async function runBrowser(
  input: unknown,
  domains: string[],
  signal?: AbortSignal,
) {
  const task = browserSchema.parse(input);
  const url = new URL(task.url);
  if (
    url.protocol !== "https:" ||
    url.username ||
    url.password ||
    (url.port && url.port !== "443")
  )
    throw new Error("Browser only accepts HTTPS public websites on port 443");
  if (!domains.includes(url.hostname))
    throw new Error(`Domain ${url.hostname} is not on the browser allowlist`);
  await requireDocker();
  const id = randomUUID().slice(0, 12);
  const network = `nexus-net-${id}`,
    proxy = `nexus-proxy-${id}`,
    browser = `nexus-browser-${id}`;
  const checked = async (args: string[]) => {
    const r = await docker(args);
    if (r.exitCode !== 0) throw new Error(r.output.slice(-1000));
    return r;
  };
  try {
    await checked(["network", "create", "--internal", network]);
    await checked([
      "run",
      "-d",
      "--name",
      proxy,
      "--network",
      "bridge",
      "--cap-drop=ALL",
      "--security-opt",
      "no-new-privileges",
      "--read-only",
      "--memory",
      "128m",
      "--pids-limit",
      "64",
      "-e",
      `NEXUS_DOMAINS=${domains.join(",")}`,
      SANDBOX_IMAGE,
      "node",
      "/app/proxy.mjs",
    ]);
    await checked([
      "network",
      "connect",
      "--alias",
      "nexus-proxy",
      network,
      proxy,
    ]);
    const result = await docker(
      [
        "run",
        "--rm",
        "-i",
        "--name",
        browser,
        "--network",
        network,
        "--cap-drop=ALL",
        "--security-opt",
        "no-new-privileges",
        "--read-only",
        "--tmpfs",
        "/tmp:rw,nosuid,size=512m",
        "--memory",
        "1g",
        "--cpus",
        "1",
        "--pids-limit",
        "256",
        "--shm-size",
        "256m",
        "-e",
        "HOME=/tmp",
        SANDBOX_IMAGE,
        "node",
        "/app/browser.mjs",
      ],
      JSON.stringify(task),
      90_000,
      signal,
    );
    if (result.exitCode !== 0) throw new Error(result.output.slice(-2000));
    const lines = result.output.trim().split("\n");
    return JSON.parse(lines.at(-1)!);
  } finally {
    await docker(["rm", "-f", browser, proxy], undefined, 10_000).catch(
      () => {},
    );
    await docker(["network", "rm", network], undefined, 10_000).catch(() => {});
  }
}
