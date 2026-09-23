import { runTests } from "@vscode/test-electron";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
const scratch = await mkdtemp(path.join(tmpdir(), "nexus-vscode-"));
try {
  await runTests({
    extensionDevelopmentPath: path.resolve("."),
    extensionTestsPath: path.resolve("tests/vscode/suite.cjs"),
    launchArgs: [
      scratch,
      "--disable-extensions",
      "--disable-workspace-trust",
      "--skip-welcome",
      "--skip-release-notes",
      "--no-sandbox",
      "--user-data-dir",
      path.join(scratch, "user-data"),
      "--extensions-dir",
      path.join(scratch, "extensions"),
    ],
    extensionTestsEnv: {
      VSCODE_CLI: "1",
      NEXUS_CONFIG: path.join(scratch, "config.json"),
    },
  });
} finally {
  await rm(scratch, { recursive: true, force: true });
}
