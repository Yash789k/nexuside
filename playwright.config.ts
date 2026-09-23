import { defineConfig } from "@playwright/test";
import path from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
process.env.NEXUS_E2E_STATE ??= path.join(
  tmpdir(),
  `nexus-e2e-${randomUUID()}.json`,
);
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    baseURL: "http://127.0.0.1:4329",
    viewport: { width: 1536, height: 1024 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "on",
  },
  webServer: {
    command: "npx tsx scripts/e2e-server.ts",
    url: "http://127.0.0.1:4329",
    reuseExistingServer: false,
    timeout: 30_000,
  },
  reporter: "list",
});
