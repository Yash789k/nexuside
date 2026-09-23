import { spawn } from "node:child_process";
const build = spawn(process.execPath, ["scripts/build.mjs"], {
  stdio: "inherit",
});
build.on("exit", (code) => {
  if (code) process.exit(code);
  const server = spawn(process.execPath, ["dist/cli.cjs", "serve"], {
    stdio: "inherit",
  });
  server.on("exit", (c) => process.exit(c ?? 0));
});
