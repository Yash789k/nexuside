import { Command } from "commander";
import { createInterface } from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { mkdir, writeFile, access, readFile, lstat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import { Workspace } from "../core/workspace";
import { Engine, approvalRevision } from "../core/engine";
import { loadConfig, configPath, envKey, saveConfig } from "../core/config";
import { available } from "../core/router";
import { openRouterCatalog } from "../core/catalog";
import { catalogModel } from "../core/openrouter";
import { Service } from "../server/service";
import { serve } from "../server/http";
import { evaluate } from "../core/evaluation";
import { docker, SANDBOX_IMAGE } from "../core/sandbox";
import type { Run, Attachment } from "../core/types";
const program = new Command()
  .exitOverride()
  .configureOutput({
    writeErr: (text) => {
      if (!process.argv.includes("--json")) process.stderr.write(text);
    },
  })
  .name("nexus")
  .description("NexusIDE — local IDE, agent and intelligent model router")
  .version("0.2.0")
  .option("-w, --workspace <path>", "Workspace directory", process.cwd());
const root = () => path.resolve(program.opts().workspace);
async function engine() {
  return new Engine(await Workspace.open(root()));
}
function printRun(run: Run, json = false, workspace = root()) {
  if (json) {
    console.log(
      JSON.stringify(
        {
          ...run,
          pending: run.pending
            ? { ...run.pending, revision: approvalRevision(run) }
            : undefined,
        },
        null,
        2,
      ),
    );
    return;
  }
  console.log(
    `\n${run.status.toUpperCase()} · ${run.id}\nModel: ${run.modelId ?? "unselected"} · Cost (reported or estimated): $${run.cost.toFixed(6)}`,
  );
  if (run.pending) {
    console.log(`\n${run.pending.title}\n${run.pending.detail}`);
    for (const c of run.pending.changes ?? []) console.log(c.diff);
    console.log(
      `\nReview: nexus -w "${workspace}" approve ${run.id} --revision ${approvalRevision(run)}`,
    );
  }
  if (run.summary) console.log("\n" + run.summary);
  if (run.error) console.error("\n" + run.error);
}
async function finish(
  e: Engine,
  run: Run,
  opts: { yes?: boolean; json?: boolean; allowHostTests?: boolean } = {},
) {
  let interrupted = false;
  let cancellation: Promise<void> | undefined;
  let cancellationError: unknown;
  const stop = new AbortController();
  const interrupt = () => {
    interrupted = true;
    stop.abort();
    cancellation ??= e.cancel(run.id).catch((err) => {
      cancellationError = err;
    });
  };
  process.on("SIGINT", interrupt);
  try {
    while (true) {
      if (run.status === "running") run = await e.drive(run.id);
      if (run.status !== "awaiting_approval") break;
      if (opts.json || (!stdin.isTTY && !opts.yes)) break;
      printRun(run, false, e.workspace.root);
      let approved = false;
      if (opts.yes && ["edits", "tests"].includes(run.pending!.kind)) {
        if (
          run.pending!.kind === "tests" &&
          run.config.testRunner === "host" &&
          !opts.allowHostTests
        ) {
          console.log(
            "Host execution needs --allow-host-tests, or approve this run explicitly.",
          );
          break;
        }
        approved = true;
      } else if (stdin.isTTY) {
        const rl = createInterface({ input: stdin, output: stdout });
        // Readline consumes terminal Ctrl+C itself; process SIGINT alone is
        // insufficient while a question is active.
        rl.once("SIGINT", interrupt);
        try {
          approved = /^y(es)?$/i.test(
            (
              await rl.question("Approve this action? [y/N] ", {
                signal: stop.signal,
              })
            ).trim(),
          );
        } catch (err) {
          if (!interrupted) throw err;
        } finally {
          rl.close();
        }
      } else break;
      if (interrupted) break;
      run = await e.decide(run.id, approved, approvalRevision(run));
    }
  } finally {
    process.removeListener("SIGINT", interrupt);
  }
  if (interrupted) {
    await cancellation;
    if (cancellationError) throw cancellationError;
    run = await e.store.get(run.id);
    process.exitCode = 130;
  }
  printRun(run, opts.json, e.workspace.root);
  if (
    !interrupted &&
    (run.status === "failed" || run.tests.some((t) => t.exitCode !== 0))
  )
    process.exitCode = 1;
  return run;
}
program
  .command("init")
  .description("Initialize NexusIDE in the workspace")
  .action(async () => {
    const w = await Workspace.open(root());
    await mkdir(await w.resolve(".nexus", true), { recursive: true });
    console.log(
      `NexusIDE initialized in ${w.root}\nUse nexus serve for the dashboard, or nexus demo for a no-key walkthrough.\nConfiguration: ${configPath()}`,
    );
  });
program
  .command("run")
  .argument("<prompt...>")
  .option("--mode <mode>", "ide or agent", "agent")
  .option("--model <id>", "auto or a configured model ID", "auto")
  .option("--priority <priority>", "economy, balanced or quality", "balanced")
  .option(
    "--attach <file>",
    "Attach a workspace image, audio or video file (repeatable)",
    (file: string, files: string[]) => [...files, file],
    [] as string[],
  )
  .option("--yes", "Approve edits and Docker tests")
  .option(
    "--allow-host-tests",
    "With --yes, explicitly authorize trusted project tests on this computer",
  )
  .option("--json", "Emit JSON and pause at approvals")
  .action(async (prompt, opts) => {
    const e = await engine();
    const attachments: Attachment[] = [];
    const mime: Record<string, string> = {
      ".png": "image/png",
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".webp": "image/webp",
      ".gif": "image/gif",
      ".wav": "audio/wav",
      ".mp3": "audio/mpeg",
      ".m4a": "audio/mp4",
      ".mp4": "video/mp4",
      ".webm": "video/webm",
    };
    if (opts.attach.length > 5) throw new Error("Attach up to five files");
    let bytes = 0;
    for (const file of opts.attach) {
      const target = await e.workspace.resolve(file.replaceAll("\\", "/"));
      const type = mime[path.extname(file).toLowerCase()];
      const stat = await lstat(target);
      bytes += stat.size;
      if (!type || !stat.isFile() || bytes > 20_000_000)
        throw new Error(
          "Attachments must be supported media files, up to 20 MB total",
        );
      attachments.push({
        name: path.basename(file),
        mime: type,
        data: (await readFile(target)).toString("base64"),
      });
    }
    const run = await e.create({
      prompt: prompt.join(" "),
      mode: opts.mode,
      model: opts.model,
      priority: opts.priority,
      attachments,
    });
    await finish(e, run, opts);
  });
program
  .command("approve")
  .argument("<id>")
  .requiredOption(
    "--revision <revision>",
    "Revision from the displayed action or JSON pending.revision",
  )
  .option("--reject", "Reject the pending action")
  .option("--json", "Emit JSON and pause at the next approval")
  .action(async (id, opts) => {
    const e = await engine();
    await finish(e, await e.decide(id, !opts.reject, opts.revision), opts);
  });
program
  .command("resume")
  .argument("<id>")
  .option("--json")
  .action(async (id, opts) => {
    const e = await engine();
    await finish(e, await e.store.get(id), opts);
  });
program
  .command("cancel")
  .argument("<id>")
  .action(async (id) => {
    await (await engine()).cancel(id);
    console.log("Cancellation recorded.");
  });
program
  .command("runs")
  .option("--json")
  .action(async (opts) => {
    const runs = await (await engine()).store.list();
    if (opts.json)
      console.log(
        JSON.stringify(
          runs.map((r) => ({ id: r.id, prompt: r.prompt, status: r.status })),
          null,
          2,
        ),
      );
    else
      console.table(
        runs.map((r) => ({
          id: r.id,
          status: r.status,
          task: r.prompt.slice(0, 60),
        })),
      );
  });
program
  .command("trace")
  .argument("<id>")
  .option("--verify", "Verify the hash chain")
  .action(async (id, opts) => {
    const e = await engine();
    if (opts.verify) {
      const ok = await e.store.verify(id);
      console.log(ok ? "Trace integrity: OK" : "Trace integrity: FAILED");
      if (!ok) process.exitCode = 1;
    } else
      for (const event of await e.store.events(id))
        console.log(JSON.stringify(event));
  });
program
  .command("eval")
  .argument("[id]")
  .option("--json")
  .action(async (id, opts) => {
    const e = await engine();
    const runs = id ? [await e.store.get(id)] : await e.store.list();
    const results = await Promise.all(
      runs.map(async (r) =>
        evaluate(r, await e.store.events(r.id), await e.store.verify(r.id)),
      ),
    );
    if (opts.json) console.log(JSON.stringify(results, null, 2));
    else
      console.table(
        results.map((r) => ({
          run: r.runId,
          status: r.status,
          score: r.score,
          verified: r.verified,
          cost: r.cost,
          blocked: r.blockedActions,
        })),
      );
  });
program.command("models").action(async () => {
  const config = await loadConfig();
  const list = await available(config, envKey);
  console.table(
    config.models.map((m) => ({
      id: m.id,
      model: m.model,
      ready: list.some((a) => a.id === m.id),
      provider: m.provider,
    })),
  );
});
const openrouter = program
  .command("openrouter")
  .description("Discover and configure OpenRouter models");
openrouter
  .command("catalog")
  .option("--search <text>", "Filter model name or ID", "")
  .option("--modality <kind>", "Filter text, image, audio or video input", "")
  .option("--json", "Print machine-readable catalog")
  .action(async (opts) => {
    if (
      opts.modality &&
      !["text", "image", "audio", "video"].includes(opts.modality)
    )
      throw new Error("Unknown modality");
    const models = await openRouterCatalog(opts.search, opts.modality);
    if (opts.json) console.log(JSON.stringify(models, null, 2));
    else
      console.table(
        models.map((m) => ({
          id: m.id,
          inputPerMillion: m.inputCost,
          outputPerMillion: m.outputCost,
          context: m.contextLength,
          input: m.capabilities.join(", "),
        })),
      );
  });
openrouter
  .command("add <model>")
  .description(
    "Add a tool-capable model from the live catalog; no API key needed",
  )
  .option("--tier <number>", "Routing tier: 1 fast, 2 balanced, 3 quality", "2")
  .option("--sort <preference>", "price, latency or throughput", "price")
  .action(async (id, opts) => {
    const found = (await openRouterCatalog()).find((m) => m.id === id);
    if (!found)
      throw new Error(
        "Model not found, lacks tool support, or has dynamic/unknown pricing",
      );
    const c = await loadConfig();
    if (c.models.some((m) => m.provider === "openrouter" && m.model === id))
      throw new Error(
        "This model is already configured. Edit its settings in the workspace UI.",
      );
    const m = catalogModel(found, Number(opts.tier));
    m.openrouter!.sort = opts.sort;
    await saveConfig({ ...c, models: [...c.models, m] });
    console.log(
      `Added ${m.id}. Set OPENROUTER_API_KEY, then run: nexus run "Your task" --model ${m.id}`,
    );
  });
program
  .command("config")
  .option("--path", "Print config path")
  .option("--init", "Write defaults if no config exists")
  .action(async (opts) => {
    if (opts.path) {
      console.log(configPath());
      return;
    }
    if (opts.init) {
      try {
        await access(configPath());
        console.log("Config already exists: " + configPath());
        return;
      } catch {}
      await saveConfig(await loadConfig());
    }
    console.log(JSON.stringify(await loadConfig(), null, 2));
  });
program.command("doctor").action(async () => {
  const config = await loadConfig();
  let dockerVersion = "Unavailable";
  try {
    const r = await docker(
      ["info", "--format", "{{.ServerVersion}}"],
      undefined,
      8000,
    );
    if (r.exitCode === 0) dockerVersion = r.output.trim();
  } catch {}
  console.log(
    `NexusIDE 0.1.0\nNode ${process.version}\nWorkspace ${root()}\nConfig ${configPath()}\nDocker ${dockerVersion}\nReady models: ${(await available(config, envKey)).map((m) => m.id).join(", ")}\nCloud credentials are optional for the offline demo.`,
  );
});
function openUrl(url: string) {
  const command =
    process.platform === "darwin"
      ? "open"
      : process.platform === "win32"
        ? "rundll32"
        : "xdg-open";
  const args =
    process.platform === "win32" ? ["url.dll,FileProtocolHandler", url] : [url];
  const c = spawn(command, args, {
    detached: true,
    stdio: "ignore",
    shell: false,
  });
  c.on("error", () => {});
  c.unref();
}
program
  .command("serve")
  .option("-p, --port <port>", "Local port", "4317")
  .option("--no-open", "Do not open the browser")
  .action(async (opts) => {
    const port = Number(opts.port);
    if (!Number.isInteger(port) || port < 0 || port > 65535)
      throw new Error("Invalid port");
    const result = await serve(
      new Service(await Workspace.open(root())),
      path.join(__dirname, "web"),
      port,
    );
    console.log(
      `NexusIDE is running. Open this private local URL:\n${result.url}\nPress Ctrl+C to stop.`,
    );
    if (opts.open) openUrl(result.url);
  });
program
  .command("demo")
  .argument(
    "[directory]",
    "Create an isolated Fibonacci demo folder",
    "nexus-demo",
  )
  .option("--yes", "Apply the demo changes and run Docker tests")
  .option("--host", "Explicitly run the known demo tests on this computer")
  .option("--json")
  .action(async (dir, opts) => {
    const dest = path.resolve(root(), dir);
    try {
      await access(dest);
      throw new Error(
        "Demo directory already exists. Choose a new directory to avoid overwriting work.",
      );
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
    await mkdir(dest, { recursive: true });
    await writeFile(
      path.join(dest, "README.md"),
      "# NexusIDE Fibonacci demo\n\nThis is an offline, deterministic installation walkthrough. No LLM is used.\n",
    );
    const e = new Engine(await Workspace.open(dest));
    const config = await loadConfig();
    if (opts.host) config.testRunner = "host";
    if (!opts.json) console.log(`Demo workspace: ${dest}`);
    await finish(
      e,
      await e.create(
        { prompt: "Add a Fibonacci function with tests", model: "demo" },
        config,
      ),
      { ...opts, allowHostTests: opts.host },
    );
  });
program
  .command("chat")
  .option("--model <id>", "Model ID", "auto")
  .action(async (opts) => {
    if (!stdin.isTTY)
      throw new Error(
        "Chat needs an interactive terminal. Use nexus run for scripts.",
      );
    const e = await engine();
    const rl = createInterface({ input: stdin, output: stdout });
    console.log("NexusIDE chat. Type /exit to leave.");
    try {
      while (true) {
        const prompt = (await rl.question("\nnexus > ")).trim();
        if (prompt === "/exit") break;
        if (!prompt) continue;
        const r = await e.create({ prompt, mode: "ide", model: opts.model });
        await finish(e, r, { json: false });
      }
    } finally {
      rl.close();
    }
  });
program
  .command("sandbox-build")
  .description(
    "Build the isolated Playwright and pytest image (requires Docker and network)",
  )
  .action(async () => {
    console.log("Building the NexusIDE sandbox image…");
    const r = await docker(
      ["build", "-t", SANDBOX_IMAGE, path.join(__dirname, "..", "sandbox")],
      undefined,
      900_000,
    );
    console.log(r.output);
    if (r.exitCode !== 0) process.exitCode = 1;
  });
program.parseAsync().catch((e) => {
  if (e.exitCode === 0) return;
  if (process.argv.includes("--json"))
    console.log(JSON.stringify({ error: e.message }));
  else console.error(`NexusIDE: ${e.message}`);
  process.exitCode = 1;
});
