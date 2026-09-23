import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  safeStorage,
  session,
  shell,
} from "electron";
import path from "node:path";
import { mkdir, realpath, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { fileURLToPath, pathToFileURL } from "node:url";
import { Workspace } from "../core/workspace";
import { Service } from "../server/service";
import { defaults, saveConfig } from "../core/config";
import { setBundledNodeRuntime } from "../core/sandbox";
import { CredentialVault, readJson, writeJson } from "./storage";
import type {
  DesktopProject,
  DesktopPreparation,
  DesktopState,
} from "./contracts";
import { version } from "../../package.json";

app.setName("NexusIDE");
// Separate profiles are also useful for clean-install QA. No renderer can set this.
if (process.env.NEXUS_DESKTOP_PROFILE)
  app.setPath("userData", path.resolve(process.env.NEXUS_DESKTOP_PROFILE));
const profile = app.getPath("userData");
process.env.NEXUS_CONFIG = path.join(profile, "config.json");
const stateFile = path.join(profile, "desktop.json");
const indexFile = path.resolve(__dirname, "../web/index.html");
let window: BrowserWindow;
let service: Service | undefined;
let project: DesktopProject | undefined;
let recent: DesktopProject[] = [];
let vault: CredentialVault;
let transition = false;
let quitting = false;
let closeRequested = false;
function finishTransition() {
  transition = false;
  if (closeRequested && !quitting) {
    closeRequested = false;
    setImmediate(() => {
      if (!window.isDestroyed()) window.close();
    });
  }
}
let preparing:
  | {
      id: string;
      resolve: (value: DesktopPreparation) => void;
      reject: (error: Error) => void;
    }
  | undefined;
const pending = new Set<Promise<unknown>>();
const downloads = "https://github.com/Yash789k/nexuside/releases/latest";
const credentialLabel = () =>
  vault.warning ||
  (vault.protectedStorage
    ? "Encrypted on this device using the system credential store"
    : "Session memory — no protected credential store available");
async function credentialOperation<T>(operation: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  try {
    return await Promise.race([
      operation,
      new Promise<T>((_resolve, reject) => {
        timer = setTimeout(
          () =>
            reject(
              new Error(
                "The system credential store did not respond. Unlock it and try again.",
              ),
            ),
          10_000,
        );
      }),
    ]);
  } finally {
    clearTimeout(timer!);
  }
}
const snapshot = (): DesktopState => ({
  version,
  project,
  recent,
  credentialStorage: credentialLabel(),
});
function trusted(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) {
  if (
    event.sender !== window.webContents ||
    event.senderFrame !== window.webContents.mainFrame
  )
    throw new Error("Untrusted application frame");
  let source: string;
  try {
    source = fileURLToPath(event.senderFrame.url);
  } catch {
    throw new Error("Untrusted application origin");
  }
  if (source !== indexFile) throw new Error("Untrusted application page");
}
function prepare(save = false): Promise<DesktopPreparation> {
  return new Promise((resolve, reject) => {
    const id = randomUUID();
    const timer = setTimeout(() => {
      preparing = undefined;
      reject(
        new Error(
          "The editor did not confirm recovery. Your window has been kept open.",
        ),
      );
    }, 15_000);
    preparing = {
      id,
      resolve: (value) => {
        clearTimeout(timer);
        preparing = undefined;
        resolve(value);
      },
      reject: (error) => {
        clearTimeout(timer);
        preparing = undefined;
        reject(error);
      },
    };
    window.webContents.send("nexus:prepare", id, save);
  });
}
async function mayLeave() {
  if (!project) return true;
  const status = await prepare();
  if (status.dirty) {
    const { response } = await dialog.showMessageBox(window, {
      type: "question",
      title: "Unsaved changes",
      message: "Save your changes before leaving this project?",
      detail:
        "Keep for recovery restores unsaved text when you reopen this project. Active agent work will be cancelled; pending approvals remain available.",
      buttons: ["Save All", "Keep for recovery", "Cancel"],
      defaultId: 0,
      cancelId: 2,
      noLink: true,
    });
    if (response === 2) return false;
    if (response === 0 && (await prepare(true)).dirty)
      throw new Error(
        "Some files could not be saved. Resolve the editor error before closing.",
      );
  } else if (service?.hasActiveJobs()) {
    const { response } = await dialog.showMessageBox(window, {
      type: "question",
      message: "Cancel active agent work and leave this project?",
      buttons: ["Cancel work and leave", "Stay"],
      defaultId: 1,
      cancelId: 1,
    });
    if (response !== 0) return false;
  }
  await Promise.allSettled([...pending]);
  await service?.shutdown();
  return true;
}
async function changed() {
  await writeJson(stateFile, { recent });
  window.setTitle(project ? `${project.name} — NexusIDE` : "NexusIDE");
  window.webContents.send("nexus:state-changed", snapshot());
  return snapshot();
}
async function enter(root: string) {
  const workspace = await Workspace.open(await realpath(root));
  project = recent.find((p) => p.path === workspace.root) ?? {
    path: workspace.root,
    name: path.basename(workspace.root),
    sessionId: randomUUID(),
  };
  service = new Service(
    workspace,
    async (m) => (m.keyEnv ? vault.get(m.keyEnv) : undefined),
    (env, key) => vault.set(env, key),
  );
  recent = [project, ...recent.filter((p) => p.path !== project!.path)].slice(
    0,
    12,
  );
  return changed();
}
async function switchProject(select: () => Promise<string | undefined>) {
  if (transition)
    throw new Error("A project transition is already in progress");
  transition = true;
  try {
    const root = await select();
    if (!root || root === project?.path) return snapshot();
    // Validate before leaving the current workspace.
    await Workspace.open(await realpath(root));
    if (!(await mayLeave())) return snapshot();
    return await enter(root);
  } finally {
    finishTransition();
  }
}
async function openProject(recentPath?: unknown) {
  return switchProject(async () => {
    if (recentPath !== undefined) {
      if (
        typeof recentPath !== "string" ||
        !recent.some((p) => p.path === recentPath)
      )
        throw new Error("Choose a project using Open Folder");
      return recentPath;
    }
    const choice = await dialog.showOpenDialog(window, {
      title: "Open a project you trust",
      properties: ["openDirectory", "createDirectory"],
    });
    return choice.canceled ? undefined : choice.filePaths[0];
  });
}
function handler(channel: string, fn: (...args: any[]) => unknown) {
  ipcMain.handle(channel, async (event, ...args) => {
    trusted(event);
    return fn(...args);
  });
}
async function showError(error: unknown) {
  await dialog.showMessageBox(window, {
    type: "error",
    message: "NexusIDE could not finish that action",
    detail: (error as Error).message,
  });
}
async function boot() {
  await mkdir(profile, { recursive: true });
  const stored = await readJson<{ recent: DesktopProject[] }>(stateFile, {
    recent: [],
  });
  recent = Array.isArray(stored.recent)
    ? stored.recent
        .filter(
          (p) =>
            typeof p.path === "string" &&
            typeof p.name === "string" &&
            /^[a-f0-9-]{36}$/.test(p.sessionId),
        )
        .slice(0, 12)
    : [];
  const protectedStorage =
    (await credentialOperation(safeStorage.isAsyncEncryptionAvailable()).catch(
      () => false,
    )) &&
    (process.platform !== "linux" ||
      safeStorage.getSelectedStorageBackend() !== "basic_text");
  vault = new CredentialVault(
    path.join(profile, "credentials.json"),
    protectedStorage,
    (v) => credentialOperation(safeStorage.encryptStringAsync(v)),
    async (v) =>
      (await credentialOperation(safeStorage.decryptStringAsync(v))).result,
  );
  await vault.load();
  const config = await readJson(process.env.NEXUS_CONFIG!, null);
  if (!config) await saveConfig({ ...defaults, testRunner: "host" });
  setBundledNodeRuntime({
    executable: process.execPath,
    env: { ELECTRON_RUN_AS_NODE: "1" },
  });
  window = new BrowserWindow({
    width: 1440,
    height: 960,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: "#111113",
    title: "NexusIDE",
    icon: path.resolve(__dirname, "../../media/desktop-icon.png"),
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      webSecurity: true,
      spellcheck: false,
    },
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.on("will-attach-webview", (event) =>
    event.preventDefault(),
  );
  session.defaultSession.setPermissionRequestHandler(
    (_wc, _permission, callback) => callback(false),
  );
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onHeadersReceived((details, callback) =>
    callback({
      responseHeaders: {
        ...details.responseHeaders,
        "Content-Security-Policy": [
          "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'none'; object-src 'none'; frame-src 'none'; base-uri 'none'",
        ],
      },
    }),
  );
  handler("nexus:state", snapshot);
  handler("nexus:open", openProject);
  handler("nexus:downloads", () => shell.openExternal(downloads));
  handler("nexus:demo", () =>
    switchProject(async () => {
      const root = path.join(
        profile,
        "workspaces",
        `Fibonacci walkthrough ${new Date().toISOString().replace(/[:.]/g, "-")}`,
      );
      await mkdir(root, { recursive: true });
      await writeFile(
        path.join(root, "README.md"),
        "# NexusIDE offline walkthrough\n\nSwitch to Agent and choose Try the offline walkthrough. Review the edits, then approve the bundled Node test runner. No provider key or Docker is required.\n",
      );
      return root;
    }),
  );
  handler("nexus:close-project", async () => {
    if (transition)
      throw new Error("A project transition is already in progress");
    transition = true;
    try {
      if (await mayLeave()) {
        service = undefined;
        project = undefined;
        return await changed();
      }
      return snapshot();
    } finally {
      finishTransition();
    }
  });
  handler("nexus:request", (action: unknown, data: unknown) => {
    if (!service) throw new Error("Open a project first");
    if (typeof action !== "string" || action.length > 80)
      throw new Error("Invalid application action");
    if (Buffer.byteLength(JSON.stringify(data ?? {})) > 36_000_000)
      throw new Error("Request is too large");
    if (
      transition &&
      [
        "start",
        "decision",
        "resume",
        "config",
        "key",
        "fileOperation",
        "restoreFile",
      ].includes(action)
    )
      throw new Error("Wait for the project transition to finish");
    const job = service
      .request(action, data)
      .then((value: any) =>
        action === "state"
          ? { ...value, credentialStorage: credentialLabel() }
          : value,
      );
    pending.add(job);
    void job.finally(() => pending.delete(job)).catch(() => {});
    return job;
  });
  ipcMain.on("nexus:prepared", (event, id, result) => {
    try {
      trusted(event);
    } catch {
      return;
    }
    const request = preparing;
    if (!request || request.id !== id) return;
    if (result?.error) request.reject(new Error(String(result.error)));
    else if (Number.isInteger(result?.value?.dirty) && result.value.dirty >= 0)
      request.resolve(result.value);
    else request.reject(new Error("Invalid recovery confirmation"));
  });
  Menu.setApplicationMenu(
    Menu.buildFromTemplate([
      ...(process.platform === "darwin" ? [{ role: "appMenu" as const }] : []),
      {
        label: "File",
        submenu: [
          {
            label: "Open Project…",
            accelerator: "CmdOrCtrl+O",
            click: () => void openProject().catch(showError),
          },
          { type: "separator" },
          { role: "close" },
          { role: "quit" },
        ],
      },
      { role: "editMenu" },
      {
        label: "View",
        submenu: [
          { role: "resetZoom" },
          { role: "zoomIn" },
          { role: "zoomOut" },
          { role: "togglefullscreen" },
        ],
      },
      { role: "windowMenu" },
      {
        label: "Help",
        submenu: [
          {
            label: "Downloads and updates",
            click: () => void shell.openExternal(downloads),
          },
        ],
      },
    ]),
  );
  window.on("close", (event) => {
    if (quitting) return;
    event.preventDefault();
    if (transition) {
      closeRequested = true;
      return;
    }
    transition = true;
    void mayLeave()
      .then((allowed) => {
        if (allowed) {
          quitting = true;
          window.destroy();
          app.quit();
        }
      })
      .catch(showError)
      .finally(finishTransition);
  });
  window.once("ready-to-show", () => window.show());
  await window.loadURL(pathToFileURL(indexFile).href);
}
if (!app.requestSingleInstanceLock()) app.quit();
else {
  app.on("second-instance", () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });
  app.on("before-quit", (event) => {
    if (!quitting && window && !window.isDestroyed()) {
      event.preventDefault();
      window.close();
    }
  });
  void app
    .whenReady()
    .then(boot)
    .catch((error) => {
      dialog.showErrorBox("NexusIDE could not start", error.message);
      quitting = true;
      app.quit();
    });
}
