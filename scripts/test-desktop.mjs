import { _electron as electron, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, readFile } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { createRequire } from "node:module";
const require = createRequire(import.meta.url);
const root = await mkdtemp(path.join(tmpdir(), "nexus-desktop-"));
const profile = path.join(root, "profile");
const project = path.join(root, "Project 空間");
const evidence = path.resolve(
  process.env.NEXUS_DESKTOP_EVIDENCE ?? "../nexuside-desktop-evidence",
);
await mkdir(project, { recursive: true });
await mkdir(evidence, { recursive: true });
await writeFile(
  path.join(project, "hello.ts"),
  "export const greeting = 'Hello';\n",
);
const errors = [],
  checks = [];
const env = { ...process.env, NEXUS_DESKTOP_PROFILE: profile };
for (const key of Object.keys(env))
  if (/(API_KEY|TOKEN|SECRET|PASSWORD)/i.test(key)) delete env[key];
delete env.ELECTRON_RUN_AS_NODE;
// The demo must use the bundled Node runtime, with no Node/npm/Docker on PATH.
if (process.platform !== "win32") env.PATH = "/usr/bin:/bin:/usr/sbin:/sbin";
let app, page;
const watchdog = setTimeout(() => {
  console.error("Desktop integration exceeded 180 seconds", checks);
  app?.process()?.kill("SIGKILL");
  process.exit(1);
}, 180_000);

async function launch() {
  app = await electron.launch({
    executablePath: process.env.NEXUS_DESKTOP_EXE ?? require("electron"),
    args: process.env.NEXUS_DESKTOP_EXE
      ? []
      : [path.resolve("dist/desktop/main.cjs")],
    env,
    timeout: 30_000,
  });
  app.process().stderr.on("data", (b) => {
    if (process.env.NEXUS_DESKTOP_DEBUG) process.stderr.write(b);
  });
  page = await app.firstWindow();
  page.on("pageerror", (error) => errors.push(error.message));
  console.log("Desktop window launched", process.platform);
  await expect(
    page.getByRole("button", { name: "Open project folder" }),
  ).toBeVisible();
}
async function chooseFolder(folder) {
  // Only the OS file chooser is stubbed; UI input, IPC, service and files are real.
  await app.evaluate(({ dialog }, value) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [value],
    });
  }, folder);
  await page.getByRole("button", { name: "Open project folder" }).click();
  await expect(
    page.getByRole("button", { name: "Projects", exact: true }),
  ).toBeVisible();
}
async function messageResponse(response) {
  await app.evaluate(({ dialog }, value) => {
    dialog.showMessageBox = async () => ({
      response: value,
      checkboxChecked: false,
    });
  }, response);
}
try {
  await launch();
  await expect(page).toHaveTitle("NexusIDE");
  expect(await page.evaluate(() => typeof window.require)).toBe("undefined");
  expect(await page.evaluate(() => typeof window.process)).toBe("undefined");
  const prefs = await app.evaluate(({ BrowserWindow }) => {
    const p =
      BrowserWindow.getAllWindows()[0].webContents.getLastWebPreferences();
    return {
      sandbox: p.sandbox,
      contextIsolation: p.contextIsolation,
      nodeIntegration: p.nodeIntegration,
    };
  });
  expect(prefs).toEqual({
    sandbox: true,
    contextIsolation: true,
    nodeIntegration: false,
  });
  await page.screenshot({ path: path.join(evidence, "desktop-welcome.png") });
  console.log("Desktop phase passed");
  checks.push(
    "Fresh launch, meaningful welcome, isolated renderer, no Node installation needed",
  );
  await chooseFolder(project);
  await page.getByRole("button", { name: "IDE", exact: true }).click();
  await page.getByRole("button", { name: "◇ hello.ts", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "Edit hello.ts" });
  await editor.fill("export const greeting = 'Saved from the desktop app';\n");
  await page.getByRole("button", { name: "Save All", exact: true }).click();
  await expect
    .poll(() => readFile(path.join(project, "hello.ts"), "utf8"))
    .toContain("Saved from the desktop app");
  await page.getByRole("button", { name: "Split Right", exact: true }).click();
  await expect(editor).toHaveCount(2);
  await editor
    .first()
    .fill("export const greeting = 'Recovered unsaved text';\n");
  await expect(editor.nth(1)).toContainText("Recovered unsaved text");
  await page.screenshot({ path: path.join(evidence, "desktop-ide.png") });
  console.log("Desktop phase passed");
  checks.push(
    "Native folder selection boundary, real files, editing/save, synchronized split views",
  );
  await messageResponse(2);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(editor).toHaveCount(2);
  await messageResponse(1);
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Open project folder" }),
  ).toBeVisible();
  await app.close();
  await launch();
  await page.getByRole("button", { name: /Project 空間/ }).click();
  await page.getByRole("button", { name: "IDE", exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: "Edit hello.ts" }).first(),
  ).toContainText("Recovered unsaved text");
  await page.getByRole("button", { name: "Save All", exact: true }).click();
  await expect
    .poll(() => readFile(path.join(project, "hello.ts"), "utf8"))
    .toContain("Recovered unsaved text");
  console.log("Desktop phase passed");
  checks.push(
    "Cancel-close, keep recovery, actual app restart, recent project and unsaved split restoration",
  );
  const escaped = await page.evaluate(async () => {
    try {
      await window.nexusDesktop.request("file", { path: "../escape" });
      return false;
    } catch {
      return true;
    }
  });
  expect(escaped).toBe(true);
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Workspace settings" }),
  ).toBeVisible();
  await page
    .getByLabel("Credential provider")
    .selectOption("OPENROUTER_API_KEY");
  await page
    .getByLabel("Provider API key")
    .fill("fixture-desktop-key-never-sent");
  await page.getByRole("button", { name: "Save key", exact: true }).click();
  await expect(
    page.getByText("Credential saved.", { exact: true }),
  ).toBeVisible();
  const credentials = await readFile(
    path.join(profile, "credentials.json"),
    "utf8",
  );
  expect(credentials).not.toContain("fixture-desktop-key-never-sent");
  const protectedStorage = credentials.includes("OPENROUTER_API_KEY");
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await app.close();
  await launch();
  await page.getByRole("button", { name: /Project 空間/ }).click();
  // Verify persisted credentials through the actual Settings status indicator.
  await page
    .getByRole("button", { name: "Open settings", exact: true })
    .click();
  const codingModel = page
    .locator("summary")
    .filter({ hasText: "OpenRouter · Coding" });
  await expect(codingModel.locator(".dot")).toHaveClass(
    protectedStorage ? /completed/ : /disabled/,
  );
  await page
    .getByLabel("Credential provider")
    .selectOption("OPENROUTER_API_KEY");
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  await expect(
    page.getByText(/Credential removed from this session/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Save settings", exact: true })
    .click();
  console.log("Desktop phase passed");
  checks.push(
    "Settings, credential restoration after restart (or explicit session fallback), removal, workspace traversal denial",
  );
  await page.getByRole("button", { name: "Projects", exact: true }).click();
  await page
    .getByRole("button", { name: /Try an offline walkthrough/ })
    .click();
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page
    .getByRole("button", { name: /Try the offline walkthrough/ })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply changes", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve test run", exact: true }),
  ).toBeVisible({ timeout: 15_000 });
  await page
    .getByRole("button", { name: "Approve test run", exact: true })
    .click();
  await expect(
    page.getByText("Completed and verified", { exact: true }),
  ).toBeVisible({ timeout: 30_000 });
  await page.getByRole("tab", { name: "Overview", exact: true }).click();
  await expect(page.getByText(/All three tests passed/).first()).toBeVisible({
    timeout: 30_000,
  });
  await page.screenshot({ path: path.join(evidence, "desktop-agent.png") });
  console.log("Desktop phase passed");
  checks.push(
    "No-key walkthrough, actual edits and three tests through bundled Node, separate approvals, no Docker",
  );
  await app.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows()[0].setSize(820, 650),
  );
  await page.screenshot({ path: path.join(evidence, "desktop-small.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(errors).toEqual([]);
  await writeFile(
    path.join(evidence, "desktop-verification.json"),
    JSON.stringify(
      {
        passed: true,
        platform: process.platform,
        executable: process.env.NEXUS_DESKTOP_EXE ?? "development Electron",
        profile,
        checks,
        errors,
        renderer: prefs,
        browserPlugin:
          "Browser plugin not available; existing Playwright Electron driver used",
      },
      null,
      2,
    ),
  );
  console.log(JSON.stringify({ passed: true, checks, evidence }, null, 2));
} catch (error) {
  if (page) {
    await page
      .screenshot({ path: path.join(evidence, "desktop-failure.png") })
      .catch(() => {});
    console.error(
      (
        await page
          .locator("body")
          .innerText()
          .catch(() => "")
      ).slice(0, 7000),
    );
  }
  throw error;
} finally {
  if (app) {
    await messageResponse(1).catch(() => {});
    await app.close().catch(() => {});
  }
  clearTimeout(watchdog);
}
