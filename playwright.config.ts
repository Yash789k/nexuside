import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./tests/e2e",
  outputDir: process.env.NEXUS_SOAK_SECONDS
    ? "../nexuside-qa-evidence/soak-run"
    : "test-results-interactions",
  fullyParallel: false,
  workers: 1,
  timeout: 30_000,
  use: {
    viewport: { width: 1536, height: 1024 },
    screenshot: "only-on-failure",
    trace: "retain-on-failure",
    video: "on",
  },
  reporter: "list",
});
