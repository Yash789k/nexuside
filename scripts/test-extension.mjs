import { createServer } from "node:net";
import {
  runTests,
  downloadAndUnzipVSCode,
  resolveCliArgsFromVSCodeExecutablePath,
} from "@vscode/test-electron";
import { mkdtemp, rm, readdir, mkdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import path from "node:path";
const scratch = await mkdtemp(path.join(tmpdir(), "nexus-vscode-"));
try {
  const reservation = createServer();
  await new Promise((r) => reservation.listen(0, "127.0.0.1", r));
  const cdpPort = reservation.address().port;
  await new Promise((r) => reservation.close(r));
  const workspace = path.join(scratch, "workspace");
  await mkdir(workspace);
  const vscodeExecutablePath = await downloadAndUnzipVSCode();
  const profile = [
    "--user-data-dir",
    path.join(scratch, "user-data"),
    "--extensions-dir",
    path.join(scratch, "extensions"),
  ];
  let extensionDevelopmentPath = path.resolve(".");
  if (process.env.NEXUS_VSIX) {
    const [cli, ...args] =
      resolveCliArgsFromVSCodeExecutablePath(vscodeExecutablePath);
    execFileSync(
      cli,
      [
        ...args,
        ...profile,
        "--install-extension",
        path.resolve(process.env.NEXUS_VSIX),
        "--force",
      ],
      { stdio: "inherit", env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" } },
    );
    const installed = (await readdir(path.join(scratch, "extensions"))).find(
      (n) => n.startsWith("nexuside-local.nexuside-"),
    );
    if (!installed) throw new Error("VSIX installation not found");
    extensionDevelopmentPath = path.join(scratch, "extensions", installed);
  }
  await runTests({
    vscodeExecutablePath,
    extensionDevelopmentPath,
    extensionTestsPath: path.resolve("tests/vscode/suite.cjs"),
    launchArgs: [
      workspace,
      `--remote-debugging-port=${cdpPort}`,
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--no-sandbox",
      ...profile,
    ],
    extensionTestsEnv: {
      VSCODE_CLI: "1",
      NEXUS_TEST_CDP: String(cdpPort),
      NEXUS_TEST_INSTALLED: process.env.NEXUS_VSIX ? "1" : "0",
      NEXUS_TEST_APP: vscodeExecutablePath.split(".app/")[0] + ".app",
      NEXUS_CONFIG: path.join(scratch, "config.json"),
    },
  });
} finally {
  await rm(scratch, { recursive: true, force: true });
}
