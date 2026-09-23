import { useCallback, useEffect, useState } from "react";
import {
  ArrowUpRight,
  Code2,
  Terminal,
  ShieldCheck,
  Square,
  LoaderCircle,
  X,
  Play,
} from "lucide-react";
import { api, type AppState, type RunView } from "./api";
import type { Mode, Priority, Attachment } from "../core/types";
import { Header, Sidebar, StatusBar } from "./components/Chrome";
import { Composer } from "./components/Composer";
import { Approval, Changes, Overview, Trace } from "./components/Review";
import { Activity } from "./components/Activity";
import { HelpDialog, SettingsDialog } from "./components/Dialogs";
import { Metrics } from "./components/Metrics";
import { FileEditor } from "./components/FileEditor";
export function App() {
  const [state, setState] = useState<AppState>(),
    [run, setRun] = useState<RunView>(),
    [selected, setSelected] = useState<string>(),
    [mode, setMode] = useState<Mode>("agent"),
    [model, setModel] = useState("auto"),
    [tab, setTab] = useState("overview"),
    [view, setView] = useState("task"),
    [file, setFile] = useState<string>(),
    [dialog, setDialog] = useState<"settings" | "help">(),
    [error, setError] = useState(""),
    [sending, setSending] = useState(false),
    [deciding, setDeciding] = useState(false),
    [mobile, setMobile] = useState(false);
  const refresh = useCallback(async () => {
    try {
      setState(await api<AppState>("state"));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);
  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), 3000);
    return () => clearInterval(timer);
  }, [refresh]);
  useEffect(() => {
    if (!selected) {
      setRun(undefined);
      return;
    }
    let alive = true;
    const fetchRun = async () => {
      try {
        const value = await api<RunView>("run", { id: selected });
        if (alive) {
          setRun(value);
          if (value.status !== "awaiting_approval") setDeciding(false);
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      }
    };
    void fetchRun();
    const timer = setInterval(() => void fetchRun(), 900);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [selected]);
  useEffect(() => setDeciding(false), [run?.pending?.call.id]);
  useEffect(() => {
    if (run?.status === "awaiting_approval" && run.pending?.kind === "edits")
      setTab("changes");
  }, [run?.status, run?.pending?.call.id]);
  const select = (id: string) => {
    setSelected(id);
    setRun(undefined);
    setFile(undefined);
    setView("task");
    setTab("overview");
    setMobile(false);
  };
  const newTask = () => {
    setSelected(undefined);
    setRun(undefined);
    setFile(undefined);
    setView("task");
    setTab("overview");
    setMobile(false);
  };
  async function start(
    prompt: string,
    priority: Priority = "balanced",
    attachments: Attachment[] = [],
    overrideModel?: string,
  ) {
    setSending(true);
    setError("");
    try {
      const result = await api("start", {
        prompt,
        mode: overrideModel === "demo" ? "agent" : mode,
        priority,
        model: overrideModel ?? model,
        attachments,
      });
      select(result.id);
      if (overrideModel) setModel(overrideModel);
      await refresh();
    } finally {
      setSending(false);
    }
  }
  async function decision(approved: boolean) {
    if (!run) return;
    setDeciding(true);
    try {
      await api("decision", { id: run.id, approved });
    } catch (e) {
      setError((e as Error).message);
      setDeciding(false);
    }
  }
  const busy = sending || run?.status === "running";
  return (
    <div className="app-shell">
      <Header
        state={state}
        mode={mode}
        setMode={setMode}
        onSettings={() => setDialog("settings")}
        onMenu={() => setMobile(!mobile)}
      />
      <div className="app-body">
        <Sidebar
          state={state}
          selected={selected}
          onSelect={select}
          onNew={newTask}
          onFile={(path) => {
            setFile(path);
            setView("task");
            setMobile(false);
          }}
          onSettings={() => setDialog("settings")}
          onHelp={() => setDialog("help")}
          onMetrics={() => {
            setView("metrics");
            setMobile(false);
          }}
          mobile={mobile}
          onClose={() => setMobile(false)}
        />
        <main className="main-panel">
          {error && (
            <div className="error-banner" role="alert">
              <span>{error}</span>
              <button
                className="icon-button"
                aria-label="Dismiss error"
                onClick={() => setError("")}
              >
                <X size={16} />
              </button>
            </div>
          )}
          {view === "metrics" ? (
            <Metrics onSelect={select} />
          ) : file ? (
            <FileEditor
              key={file}
              path={file}
              onClose={() => setFile(undefined)}
              onSaved={() => void refresh()}
            />
          ) : (
            <>
              <div className="task-surface">
                {run ? (
                  <>
                    <div className="task-heading">
                      <div>
                        <h1>{run.prompt}</h1>
                        <p>
                          {run.status === "awaiting_approval"
                            ? "Review the next action"
                            : run.status === "running"
                              ? "Your agent is working"
                              : run.status === "completed"
                                ? run.evaluation.verified
                                  ? "Completed and verified"
                                  : "Completed · review the result"
                                : run.status === "cancelled"
                                  ? "Task cancelled"
                                  : "Task needs attention"}
                        </p>
                      </div>
                      {["running", "awaiting_approval"].includes(
                        run.status,
                      ) && (
                        <button
                          className="icon-button stop-button"
                          title="Cancel task"
                          aria-label="Cancel task"
                          onClick={() =>
                            void api("cancel", { id: run.id }).catch((e) =>
                              setError(e.message),
                            )
                          }
                        >
                          <Square size={15} />
                        </button>
                      )}
                    </div>
                    <div
                      className="tabs"
                      role="tablist"
                      aria-label="Task details"
                    >
                      {["overview", "changes", "trace"].map((t) => (
                        <button
                          key={t}
                          role="tab"
                          aria-selected={tab === t}
                          className={tab === t ? "active" : ""}
                          onClick={() => setTab(t)}
                        >
                          {t[0].toUpperCase() + t.slice(1)}
                          {t === "changes" &&
                            (run.pending?.changes?.length ??
                              run.changes.length) > 0 && (
                              <span className="count">
                                {run.pending?.changes?.length ??
                                  run.changes.length}
                              </span>
                            )}
                        </button>
                      ))}
                      <span className={`run-state ${run.status}`}>
                        {run.status === "running" && (
                          <LoaderCircle size={12} className="spin" />
                        )}
                        {run.status.replaceAll("_", " ")}
                      </span>
                    </div>
                    <div className="task-content">
                      <Approval
                        run={run}
                        onDecision={(a) => void decision(a)}
                        busy={deciding}
                      />
                      {tab === "changes" ? (
                        <Changes run={run} />
                      ) : tab === "trace" ? (
                        <Trace run={run} />
                      ) : (
                        <Overview run={run} />
                      )}
                    </div>
                  </>
                ) : selected ? (
                  <div className="inline-empty">
                    <LoaderCircle size={25} className="spin" />
                    <p>Opening task…</p>
                  </div>
                ) : (
                  <div className="welcome">
                    <div className="welcome-symbol">
                      <Code2 size={32} />
                    </div>
                    <h1>What are we building?</h1>
                    <p>
                      One workspace. The right model.
                      <br />A clear path from idea to verified code.
                    </p>
                    <div className="welcome-actions">
                      <button
                        onClick={() =>
                          void start(
                            "Add a Fibonacci function with tests",
                            "balanced",
                            [],
                            "demo",
                          ).catch((e) => setError(e.message))
                        }
                        disabled={sending}
                      >
                        <Code2 size={18} />
                        <span>
                          Try the offline walkthrough
                          <small>Add a Fibonacci function and tests</small>
                        </span>
                        <ArrowUpRight size={17} />
                      </button>
                      <button onClick={() => setDialog("settings")}>
                        <ShieldCheck size={18} />
                        <span>
                          Connect your models
                          <small>OpenRouter, OpenAI, Claude, Gemini, or Ollama</small>
                        </span>
                        <ArrowUpRight size={17} />
                      </button>
                    </div>
                    <p className="welcome-note">
                      Your workspace stays local. You review every change.
                    </p>
                  </div>
                )}
              </div>
              <Composer
                state={state}
                model={model}
                setModel={setModel}
                busy={!!busy}
                onError={setError}
                onSubmit={start}
              />
            </>
          )}
        </main>
        {view === "task" && !file && (
          <Activity
            state={state}
            run={run}
            onChanges={() => setTab("changes")}
          />
        )}
      </div>
      <StatusBar state={state} />
      {dialog === "settings" && state && (
        <SettingsDialog
          state={state}
          onClose={() => setDialog(undefined)}
          onSaved={() => void refresh()}
        />
      )}
      {dialog === "help" && <HelpDialog onClose={() => setDialog(undefined)} />}
    </div>
  );
}
