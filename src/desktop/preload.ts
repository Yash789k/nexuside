import { contextBridge, ipcRenderer } from "electron";
import type { DesktopBridge } from "./contracts";
const bridge: DesktopBridge = {
  request: (action, data = {}) =>
    ipcRenderer.invoke("nexus:request", action, data),
  state: () => ipcRenderer.invoke("nexus:state"),
  openProject: (recentPath) => ipcRenderer.invoke("nexus:open", recentPath),
  createDemo: () => ipcRenderer.invoke("nexus:demo"),
  closeProject: () => ipcRenderer.invoke("nexus:close-project"),
  openDownloads: () => ipcRenderer.invoke("nexus:downloads"),
  rememberCredentials: (enabled) =>
    ipcRenderer.invoke("nexus:remember-credentials", enabled),
  onState: (fn) => {
    const listener = (_event: unknown, state: Parameters<typeof fn>[0]) =>
      fn(state);
    ipcRenderer.on("nexus:state-changed", listener);
    return () => ipcRenderer.removeListener("nexus:state-changed", listener);
  },
  onPrepare: (fn) => {
    const listener = (_event: unknown, id: string, save: boolean) => {
      void fn(save).then(
        (value) => ipcRenderer.send("nexus:prepared", id, { value }),
        (error) =>
          ipcRenderer.send("nexus:prepared", id, {
            error: String(error?.message ?? error),
          }),
      );
    };
    ipcRenderer.on("nexus:prepare", listener);
    return () => ipcRenderer.removeListener("nexus:prepare", listener);
  },
};
contextBridge.exposeInMainWorld("nexusDesktop", bridge);
