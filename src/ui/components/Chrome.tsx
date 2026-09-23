import { useState } from "react";
import {
  Plus,
  FileCode2,
  Settings,
  Terminal,
  Folder,
  BarChart3,
  Menu,
  ChevronRight,
  X,
} from "lucide-react";
import type { AppState } from "../api";
import type { Mode } from "../../core/types";
export function Header({
  state,
  mode,
  setMode,
  onSettings,
  onMenu,
}: {
  state?: AppState;
  mode: Mode;
  setMode: (m: Mode) => void;
  onSettings: () => void;
  onMenu: () => void;
}) {
  return (
    <header className="topbar">
      <div className="brand">
        <button
          className="icon-button mobile-menu"
          aria-label="Toggle workspace menu"
          onClick={onMenu}
        >
          <Menu size={20} />
        </button>
        <span className="brandmark">N</span>
        <strong>NexusIDE</strong>
      </div>
      <div className="mode-switch" aria-label="Workspace mode">
        <button
          className={mode === "ide" ? "selected" : ""}
          onClick={() => setMode("ide")}
        >
          IDE
        </button>
        <button
          className={mode === "agent" ? "selected" : ""}
          onClick={() => setMode("agent")}
        >
          Agent
        </button>
      </div>
      <div className="workspace-title">
        <Folder size={16} />
        <span>{state?.name ?? "Connecting…"}</span>
        <button
          className="icon-button"
          aria-label="Open settings"
          onClick={onSettings}
        >
          <Settings size={20} />
        </button>
      </div>
    </header>
  );
}
export function Sidebar({
  state,
  selected,
  onSelect,
  onNew,
  onFile,
  onSettings,
  onHelp,
  onMetrics,
  mobile,
  onClose,
}: {
  state?: AppState;
  selected?: string;
  onSelect: (id: string) => void;
  onNew: () => void;
  onFile: (path: string) => void;
  onSettings: () => void;
  onHelp: () => void;
  onMetrics: () => void;
  mobile: boolean;
  onClose: () => void;
}) {
  const [recentLimit, setRecentLimit] = useState(30),
    [runQuery, setRunQuery] = useState("");
  return (
    <aside className={`sidebar ${mobile ? "mobile-open" : ""}`}>
      <button className="new-task" onClick={onNew}>
        <Plus size={17} />
        New task
      </button>
      <div className="sidebar-section files-section">
        <span className="section-label">Workspace</span>
        {state && state.files.length > 100 && (
          <small>First 100 files. Open IDE for the full index.</small>
        )}
        <div className="file-list">
          {state?.files.length ? (
            state.files.slice(0, 100).map((file) => (
              <button
                className="file-row"
                key={file}
                onClick={() => onFile(file)}
                title={file}
              >
                <FileCode2 size={16} />
                <span>{file}</span>
              </button>
            ))
          ) : (
            <p className="subtle sidebar-empty">Your files will appear here.</p>
          )}
        </div>
      </div>
      <div className="sidebar-section recent-section">
        <span className="section-label">Recent runs</span>
        <input
          className="run-filter"
          aria-label="Filter run history"
          placeholder="Find a run…"
          value={runQuery}
          onChange={(e) => setRunQuery(e.target.value)}
        />
        <div className="recent-list">
          {state?.runs
            .filter((r) =>
              r.prompt.toLowerCase().includes(runQuery.toLowerCase()),
            )
            .slice(0, recentLimit)
            .map((run) => (
              <button
                className={`run-row ${selected === run.id ? "active" : ""}`}
                key={run.id}
                onClick={() => onSelect(run.id)}
              >
                <span className={`dot ${run.status}`} />
                <span>
                  {run.prompt}
                  <small>{run.status.replaceAll("_", " ")}</small>
                </span>
              </button>
            ))}
        </div>
      </div>
      {state && state.runs.length > recentLimit && (
        <button
          className="quiet-button"
          onClick={() => setRecentLimit((n) => n + 30)}
        >
          Show more runs ({state.runs.length})
        </button>
      )}
      <nav className="sidebar-nav">
        <button onClick={onMetrics}>
          <BarChart3 size={18} />
          Evaluations
        </button>
        <button onClick={onSettings}>
          <Settings size={18} />
          Settings
        </button>
        <button onClick={onHelp}>
          <Terminal size={18} />
          CLI help
        </button>
      </nav>
    </aside>
  );
}
export function StatusBar({ state }: { state?: AppState }) {
  return (
    <footer className="statusbar">
      <span>
        <Folder size={15} />
        {state?.name ?? "Workspace"}
        <i />
        <b className="dot" />
        Local workspace
      </span>
      <span>NexusIDE {state?.version ?? "0.2.0"}</span>
    </footer>
  );
}
