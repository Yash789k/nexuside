import { useEffect, useState } from "react";
import { ArrowUpRight, FolderOpen, Code2, ShieldCheck } from "lucide-react";
import { App } from "./App";
import { prepareDesktopEditor } from "./api";
import type { DesktopState } from "../desktop/contracts";
export function Desktop() {
  const bridge = window.nexusDesktop!;
  const [state, setState] = useState<DesktopState>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const update = (value: DesktopState) => {
      let meta = document.querySelector<HTMLMetaElement>(
        'meta[name="nexus-session"]',
      );
      if (!meta) {
        meta = document.createElement("meta");
        meta.name = "nexus-session";
        document.head.append(meta);
      }
      meta.content = value.project?.sessionId ?? "";
      setState(value);
    };
    void bridge
      .state()
      .then(update)
      .catch((e) => setError(e.message));
    const offState = bridge.onState(update);
    const offPrepare = bridge.onPrepare(prepareDesktopEditor);
    return () => {
      offState();
      offPrepare();
    };
  }, [bridge]);
  async function action(fn: () => Promise<unknown>) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await fn();
    } catch (e) {
      setError(
        (e as Error).message.replace(
          /^Error invoking remote method '[^']+': Error: /,
          "",
        ),
      );
    } finally {
      setBusy(false);
    }
  }
  if (state?.project)
    return (
      <div className="desktop-workspace">
        <div className="desktop-project-bar">
          <button
            disabled={busy}
            onClick={() => void action(() => bridge.closeProject())}
          >
            <FolderOpen size={15} /> Projects
          </button>
          <span title={state.project.path}>{state.project.path}</span>
          <small>Desktop · {state.version}</small>
        </div>
        {error && (
          <div className="desktop-error" role="alert">
            {error}
            <button onClick={() => setError("")}>Dismiss</button>
          </div>
        )}
        <App key={state.project.sessionId} />
      </div>
    );
  return (
    <main className="desktop-welcome">
      <header className="desktop-welcome-top">
        <div className="brand">
          <span className="brandmark">N</span>
          <strong>NexusIDE</strong>
          <span className="desktop-badge">DESKTOP</span>
        </div>
        <button onClick={() => void action(bridge.openDownloads)}>
          Downloads & updates <ArrowUpRight size={15} />
        </button>
      </header>
      <div className="desktop-welcome-content">
        <section className="desktop-intro">
          <p className="desktop-eyebrow">YOUR PROJECT. YOUR MODELS.</p>
          <h1>
            A workspace for
            <br />
            you and your agents.
          </h1>
          <p className="desktop-description">
            Edit with focus. Hand off a task. Review every change.
            <br />
            Your project stays on your computer.
          </p>
          <div className="desktop-actions">
            <button
              className="desktop-primary"
              disabled={busy || !state}
              onClick={() => void action(() => bridge.openProject())}
            >
              <FolderOpen size={19} />
              Open project folder
              <ArrowUpRight size={18} />
            </button>
            <button
              className="desktop-demo"
              disabled={busy || !state}
              onClick={() => void action(bridge.createDemo)}
            >
              <Code2 size={19} />
              <span>
                Try an offline walkthrough
                <small>No API key or Docker needed</small>
              </span>
            </button>
          </div>
          {busy && <p role="status">Opening your workspace…</p>}
          {error && (
            <p className="desktop-error" role="alert">
              {error}
            </p>
          )}
          <div className="desktop-getting-started">
            <ShieldCheck size={19} />
            <p>
              Choose a project you trust. Add your provider in Settings.
              <br />
              File changes and test execution ask for approval.
            </p>
          </div>
        </section>
        <aside className="desktop-recent" aria-label="Recent projects">
          <div className="desktop-recent-heading">
            <span>Recent projects</span>
            <small>{state?.recent.length ?? 0}</small>
          </div>
          {state?.recent.length ? (
            state.recent.map((p) => (
              <button
                key={p.path}
                disabled={busy}
                onClick={() => void action(() => bridge.openProject(p.path))}
              >
                <FolderOpen size={19} />
                <span>
                  <strong>{p.name}</strong>
                  <small title={p.path}>{p.path}</small>
                </span>
                <ArrowUpRight size={16} />
              </button>
            ))
          ) : (
            <div className="desktop-empty">
              <FolderOpen size={28} />
              <h2>Start with a folder</h2>
              <p>
                Your recent projects will appear here.
                <br />
                Existing files stay exactly where they are.
              </p>
            </div>
          )}
          <div className="desktop-mode-note">
            <strong>Two ways to work</strong>
            <p>
              <b>IDE</b> — files, editing and contextual help.
            </p>
            <p>
              <b>Agent</b> — tasks, approvals and results.
            </p>
          </div>
        </aside>
      </div>
      <footer>
        <span>Local workspace · OpenRouter and other providers</span>
        <span>Version {state?.version ?? "…"}</span>
      </footer>
    </main>
  );
}
