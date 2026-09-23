import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { Workspace } from "../src/core/workspace";
import { Service } from "../src/server/service";
import { serve } from "../src/server/http";
import { defaults } from "../src/core/config";
const dir = await mkdtemp(path.join(tmpdir(), "nexus-browser-test-"));
process.env.NEXUS_CONFIG = path.join(dir, "config.json");
await writeFile(
  process.env.NEXUS_CONFIG,
  JSON.stringify({ ...defaults, testRunner: "host" }),
);
const workspace = path.join(dir, "workspace");
await mkdir(workspace);
await writeFile(path.join(workspace, "README.md"), "# Fibonacci workspace\n");
const app = await serve(
  new Service(await Workspace.open(workspace)),
  path.resolve("dist/web"),
  4383,
);
await writeFile(
  process.env.NEXUS_E2E_STATE!,
  JSON.stringify({ url: app.url, workspace }),
);
console.log("NexusIDE browser test server ready");
for (const signal of ["SIGTERM", "SIGINT"] as const)
  process.on(signal, () => {
    app.server.close();
    void rm(dir, { recursive: true, force: true })
      .then(() => rm(process.env.NEXUS_E2E_STATE!, { force: true }))
      .finally(() => process.exit(0));
  });
