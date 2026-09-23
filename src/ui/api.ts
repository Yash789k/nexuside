import type {
  Run,
  TraceEvent,
  EvalResult,
  Config,
  ModelConfig,
} from "../core/types";
export interface AppState {
  workspace: string;
  name: string;
  models: (ModelConfig & { configured: boolean })[];
  config: Config;
  configPath: string;
  files: string[];
  index: {
    files: string[];
    directories: string[];
    limited: boolean;
    limit: number;
    depth: number;
  };
  runs: Pick<Run, "id" | "prompt" | "status" | "createdAt" | "modelId">[];
  version: string;
  credentialStorage: string;
}
export type RunView = Run & {
  events: TraceEvent[];
  evaluation: EvalResult;
  operationError?: string;
};
declare global {
  interface Window {
    acquireVsCodeApi?: () => { postMessage: (message: unknown) => void };
  }
}
const vscode = window.acquireVsCodeApi?.();
const awaiting = new Map<
  string,
  { resolve: (data: any) => void; reject: (error: Error) => void }
>();
window.addEventListener("message", (event) => {
  if (event.data?.type !== "nexus-response") return;
  const p = awaiting.get(event.data.id);
  if (!p) return;
  awaiting.delete(event.data.id);
  event.data.error
    ? p.reject(new Error(event.data.error))
    : p.resolve(event.data.data);
});
const fragment = new URLSearchParams(location.hash.slice(1));
if (fragment.has("token")) {
  sessionStorage.setItem("nexus-token", fragment.get("token")!);
  history.replaceState(null, "", location.pathname);
}
export async function api<T = any>(
  action: string,
  data: unknown = {},
): Promise<T> {
  if (vscode) {
    const id = crypto.randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        awaiting.delete(id);
        reject(new Error("The extension did not respond. Reopen NexusIDE."));
      }, 120_000);
      awaiting.set(id, {
        resolve: (d) => {
          clearTimeout(timer);
          resolve(d);
        },
        reject: (e) => {
          clearTimeout(timer);
          reject(e);
        },
      });
      vscode.postMessage({ type: "nexus-request", id, action, data });
    });
  }
  const r = await fetch(`/api/${action}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${sessionStorage.getItem("nexus-token") ?? ""}`,
    },
    body: JSON.stringify(data),
  });
  const result = await r.json();
  if (!r.ok) throw new Error(result.error ?? "Request failed");
  return result;
}

export function recoveryId(workspace: string) {
  const supplied = document.querySelector<HTMLMetaElement>(
    'meta[name="nexus-session"]',
  )?.content;
  const key = `nexus-editor:${workspace}`;
  let id = supplied ?? sessionStorage.getItem(key);
  if (!id) {
    id = crypto.randomUUID();
    sessionStorage.setItem(key, id);
  }
  return id;
}
export function cacheRecovery(workspace: string, value: unknown) {
  // Webview state also protects edits while the host recreates its webview document.
  const host = vscode as any;
  if (host?.setState) host.setState({ workspace, recovery: value });
}
export function cachedRecovery(workspace: string) {
  const value = (vscode as any)?.getState?.();
  return value?.workspace === workspace ? value.recovery : undefined;
}
