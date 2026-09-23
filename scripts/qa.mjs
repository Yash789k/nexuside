import { spawn } from "node:child_process";
const args = process.argv.slice(2),
  soak = args[0] === "soak";
const child = spawn(
  process.execPath,
  [
    "node_modules/@playwright/test/cli.js",
    "test",
    ...(soak ? ["tests/e2e/soak.spec.ts"] : args),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      ...(soak
        ? { NEXUS_SOAK_SECONDS: process.env.NEXUS_SOAK_SECONDS ?? "1800" }
        : {}),
    },
  },
);
child.on("exit", (code) => process.exit(code ?? 1));
