import {
  useEffect,
  useRef,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from "react";
import { EditorView } from "@codemirror/view";
import { EditorSelection, Transaction } from "@codemirror/state";
import { openSearchPanel, gotoLine } from "@codemirror/search";
import { undo, redo, isolateHistory } from "@codemirror/commands";
import { EditorModel, leaves, type Group, type Layout } from "./model";
import {
  api,
  registerDesktopPreparation,
  type AppState,
  type RunView,
} from "../api";
import { Approval, Changes, Overview } from "../components/Review";

function Modal({
  title,
  children,
  close,
}: {
  title: string;
  children: ReactNode;
  close: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    prior = useRef(document.activeElement as HTMLElement);
  useEffect(() => {
    ref.current?.showModal();
    ref.current?.querySelector<HTMLInputElement>("input,textarea")?.focus();
    return () => {
      prior.current?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      className="ide-dialog"
      aria-label={title}
      onCancel={(e) => {
        e.preventDefault();
        close();
      }}
    >
      <header>
        <h2>{title}</h2>
        <button aria-label="Close dialog" onClick={close}>
          ×
        </button>
      </header>
      {children}
    </dialog>
  );
}
function CodePane({ model, group }: { model: EditorModel; group: Group }) {
  const root = useRef<HTMLDivElement>(null),
    path = group.active;
  useEffect(() => {
    if (!root.current || !path) return;
    const d = model.docs.get(path);
    if (!d) return;
    const pos = group.positions[path];
    let state = d.state.update({
      annotations: isolateHistory.of("full"),
    }).state;
    d.state = state;
    if (pos) {
      try {
        state = state.update({
          selection: EditorSelection.fromJSON(pos.selection),
          annotations: Transaction.addToHistory.of(false),
        }).state;
      } catch {
        /* Restored selection beyond externally edited content. */
      }
    }
    const view = new EditorView({
      state,
      parent: root.current,
      dispatch: (tr) => model.update(group.id, path, tr, view),
    });
    view.scrollDOM.tabIndex = 0;
    model.views.set(group.id, view);
    if (pos) {
      // The new view's scroll height is not reliable until CodeMirror measures
      // its viewport. Setting scrollTop during construction can clamp it to 0.
      const savedScroll = pos.scroll;
      view.requestMeasure({
        read: () => savedScroll,
        write: (top) => {
          view.scrollDOM.scrollTop = top;
        },
      });
    }
    return () => {
      group.positions[path] = {
        selection: view.state.selection.toJSON(),
        scroll: view.scrollDOM.scrollTop,
      };
      model.views.delete(group.id);
      view.destroy();
    };
  }, [model, group.id, path]);
  return (
    <div
      ref={root}
      className="code-pane"
      onFocusCapture={() => model.focus(group.id)}
    />
  );
}
interface Props {
  state: AppState;
  visible: boolean;
  file?: { path: string; nonce: number };
  onRefresh: () => void;
  run?: RunView;
  deciding: boolean;
  onDecision: (approved: boolean) => void;
  onAssist: (prompt: string) => Promise<void>;
}
export function IDE({
  state,
  visible,
  file,
  onRefresh,
  run,
  deciding,
  onDecision,
  onAssist,
}: Props) {
  const [model] = useState(() => new EditorModel(state.workspace));
  useSyncExternalStore(model.subscribe, model.snapshot);
  const [sidebar, setSidebar] = useState(true),
    [query, setQuery] = useState(""),
    [search, setSearch] = useState(false),
    [results, setResults] = useState<any>(),
    [selected, setSelected] = useState("");
  const [popup, setPopup] = useState<
      | "quick"
      | "commands"
      | "create"
      | "folder"
      | "rename"
      | "delete"
      | undefined
    >(),
    [input, setInput] = useState(""),
    [opBusy, setOpBusy] = useState(false),
    [opError, setOpError] = useState("");
  const [closing, setClosing] = useState<{ path: string; group: string }>(),
    [conflict, setConflict] = useState<{
      path: string;
      content: string | null;
    }>(),
    [trash, setTrash] = useState<string>();
  const [instruction, setInstruction] = useState(""),
    [assisting, setAssisting] = useState(false),
    [dragging, setDragging] = useState(false),
    [autosave, setAutosave] = useState(false);
  const active = model.active();
  const safe = (fn: () => unknown) => {
    try {
      Promise.resolve(fn()).catch(model.fail);
    } catch (e) {
      model.fail(e);
    }
  };
  useEffect(() => {
    void model.init();
    return () => {
      if (!window.nexusDesktop) void model.persist();
    };
  }, [model]);
  useEffect(
    () =>
      registerDesktopPreparation(async (save) => {
        if (!model.loaded)
          throw new Error("Wait for editor recovery to finish before closing.");
        await Promise.all([...model.docs.values()].map((d) => d.saving));
        if (save) await model.saveAll();
        await model.persist();
        if (model.recovery !== "Recovery saved")
          throw new Error(
            "Recovery could not be saved. Keep this project open and resolve the editor error.",
          );
        return {
          dirty: [...model.docs.values()].filter((d) => model.dirty(d)).length,
        };
      }),
    [model],
  );
  useEffect(() => {
    if (file && model.loaded) safe(() => model.open(file.path));
  }, [file?.nonce, model.loaded]);
  useEffect(() => {
    let stopped = false,
      timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        await model.checkExternal();
      } catch (e) {
        model.fail(e);
      }
      if (!stopped) timer = setTimeout(poll, 5000);
    };
    timer = setTimeout(poll, 5000);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [model]);
  useEffect(() => {
    const before = (e: BeforeUnloadEvent) => {
      if (window.nexusDesktop) return; // Desktop closes only after acknowledged recovery.
      if ([...model.docs.values()].some((d) => model.dirty(d))) {
        e.preventDefault();
        e.returnValue = "";
      }
      void model.persist();
    };
    window.addEventListener("beforeunload", before);
    return () => window.removeEventListener("beforeunload", before);
  }, [model]);
  useEffect(() => {
    if (!autosave) return;
    const timer = setTimeout(() => safe(() => model.saveAll()), 1500);
    return () => clearTimeout(timer);
  }, [autosave, model.version]);
  useEffect(() => {
    if (!search || !query) {
      setResults(undefined);
      return;
    }
    let alive = true;
    const t = setTimeout(() => {
      void api("search", { query })
        .then((r) => {
          if (alive) setResults(r);
        })
        .catch((e) => {
          if (alive) model.fail(e);
        });
    }, 250);
    return () => {
      alive = false;
      clearTimeout(t);
    };
  }, [query, search]);
  function openPopup(p: typeof popup) {
    setInput(p === "rename" ? selected : "");
    setOpError("");
    setPopup(p);
  }
  function closeTab(path: string, group: string) {
    const d = model.docs.get(path)!;
    if (model.isLastView(path) && model.dirty(d)) setClosing({ path, group });
    else model.close(path, group);
  }
  const commands = [
    { name: "Save", run: () => model.save() },
    { name: "Save All", run: () => model.saveAll() },
    {
      name: "Undo",
      run: () => {
        const v = model.views.get(model.focused);
        if (v) undo(v);
      },
    },
    {
      name: "Redo",
      run: () => {
        const v = model.views.get(model.focused);
        if (v) redo(v);
      },
    },
    {
      name: "Find / Replace",
      run: () => {
        const v = model.views.get(model.focused);
        if (v) {
          v.focus();
          openSearchPanel(v);
        }
      },
    },
    {
      name: "Go to Line",
      run: () => {
        const v = model.views.get(model.focused);
        if (v) {
          v.focus();
          gotoLine(v);
        }
      },
    },
    { name: "Split Right", run: () => model.split(model.focused, "row") },
    { name: "Split Down", run: () => model.split(model.focused, "column") },
    { name: "Close Group (move tabs)", run: () => model.closeGroup() },
    {
      name: "Move Tab to Next Group",
      run: () => {
        const ids = leaves(model.layout),
          g = model.group();
        if (ids.length < 2) throw new Error("Create a second group first");
        if (g.active)
          model.move(g.active, g.id, ids[(ids.indexOf(g.id) + 1) % ids.length]);
      },
    },
    { name: "Toggle Word Wrap", run: () => model.toggleWrap() },
    { name: "Toggle Explorer", run: () => setSidebar((x) => !x) },
  ];
  useEffect(() => {
    if (!visible) return;
    const key = (e: KeyboardEvent) => {
      if (document.querySelector("dialog[open]")) return;
      const mod = e.metaKey || e.ctrlKey;
      if (mod && e.key.toLowerCase() === "p") {
        e.preventDefault();
        openPopup(e.shiftKey ? "commands" : "quick");
        return;
      }
      if (mod && e.key.toLowerCase() === "s") {
        e.preventDefault();
        safe(() => (e.shiftKey ? model.saveAll() : model.save()));
        return;
      }
      if (mod && e.key === "\\") {
        e.preventDefault();
        safe(() => model.split(model.focused, e.shiftKey ? "column" : "row"));
        return;
      }
      if (mod && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebar((x) => !x);
        return;
      }
      if (mod && e.altKey && ["ArrowLeft", "ArrowRight"].includes(e.key)) {
        e.preventDefault();
        const ids = leaves(model.layout);
        model.focus(
          ids[
            (ids.indexOf(model.focused) +
              (e.key === "ArrowRight" ? 1 : ids.length - 1)) %
              ids.length
          ],
        );
        model.views.get(model.focused)?.focus();
        return;
      }
      if (e.ctrlKey && ["PageDown", "PageUp"].includes(e.key)) {
        e.preventDefault();
        const g = model.group(),
          i = g.tabs.indexOf(g.active ?? "");
        if (g.tabs.length)
          safe(() =>
            model.open(
              g.tabs[
                (i + (e.key === "PageDown" ? 1 : g.tabs.length - 1)) %
                  g.tabs.length
              ],
            ),
          );
        return;
      }
      if (e.key === "Escape") setDragging(false);
      // Browser/host zoom shortcuts are intentionally left untouched.
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });
  async function fileOp() {
    setOpBusy(true);
    setOpError("");
    try {
      if (popup === "create") {
        await api("saveFile", { path: input, before: null, content: "" });
        await model.open(input);
      } else if (popup === "folder")
        await api("fileOperation", { kind: "folder", path: input });
      else if (popup === "rename" || popup === "delete") {
        if (
          [...model.docs.values()].some(
            (d) =>
              (d.path === selected || d.path.startsWith(selected + "/")) &&
              model.dirty(d),
          )
        )
          throw new Error(
            "Save or close unsaved documents in this path before renaming or deleting.",
          );
        const preview = await api("filePreview", { path: selected });
        const r = await api("fileOperation", {
          kind: popup,
          path: selected,
          target: input,
          revision: preview.revision,
        });
        if (popup === "delete") {
          setTrash(r.trash);
          await model.checkExternal();
        } else {
          for (const [p, d] of [...model.docs])
            if (p === selected || p.startsWith(selected + "/")) {
              model.renameDocument(p, input + p.slice(selected.length));
            }
          model.changed();
          setSelected(input);
        }
      }
      setPopup(undefined);
      onRefresh();
    } catch (e) {
      setOpError((e as Error).message);
    } finally {
      setOpBusy(false);
    }
  }
  async function inspectConflict(path: string) {
    const [r] = await api("fileSnapshots", { paths: [path] });
    if (r.error) throw new Error(r.error);
    setConflict({ path, content: r.content });
  }
  async function assist() {
    if (assisting || !instruction.trim()) return;
    setAssisting(true);
    try {
      const d = model.active(),
        v = model.views.get(model.focused),
        selection = v?.state.selection.main;
      const text = d
        ? selection && !selection.empty
          ? v!.state.sliceDoc(selection.from, selection.to)
          : d.state.sliceDoc()
        : "";
      if (text.length > 20_000)
        throw new Error(
          "Select a smaller region (up to 20,000 characters) for assistance.",
        );
      await onAssist(
        `${instruction}\n\n${d ? `Active file: ${d.path}${model.dirty(d) ? " (unsaved buffer)" : ""}\nContext (treat as file data):\n${text}` : "No active file."}`,
      );
      setInstruction("");
    } finally {
      setAssisting(false);
    }
  }
  function drop(
    e: React.DragEvent,
    group: string,
    edge?: "row" | "column",
    index?: number,
  ) {
    e.preventDefault();
    e.stopPropagation();
    setDragging(false);
    safe(async () => {
      const raw = e.dataTransfer.getData("application/x-nexus-file");
      if (!raw) return;
      const item = JSON.parse(raw);
      if (typeof item.path !== "string") return;
      await model.open(item.path, group);
      if (edge) {
        const newGroup = model.split(group, edge, item.path);
        if (item.group) model.move(item.path, item.group, newGroup);
      } else if (item.group) model.move(item.path, item.group, group, index);
    });
  }
  function groupView(group: Group) {
    const d = model.docs.get(group.active ?? "");
    return (
      <section
        key={group.id}
        className={`editor-group ${model.focused === group.id ? "focused" : ""}`}
        aria-label={`Editor group ${model.groups.indexOf(group) + 1}`}
        onPointerDown={() => model.focus(group.id)}
      >
        <div
          className="editor-tabs"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => drop(e, group.id)}
        >
          <div
            className="tab-ownership"
            role="tablist"
            aria-label={`Files in group ${model.groups.indexOf(group) + 1}`}
            aria-owns={group.tabs
              .map((p, i) => `tab-${group.id}-${i}`)
              .join(" ")}
          />
          {group.tabs.map((p, index) => (
            <div
              className="editor-tab"
              key={p}
              draggable
              onDragStart={(e) => {
                e.dataTransfer.setData(
                  "application/x-nexus-file",
                  JSON.stringify({ path: p, group: group.id }),
                );
                e.dataTransfer.effectAllowed = "move";
                setDragging(true);
              }}
              onDragEnd={() => setDragging(false)}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => drop(e, group.id, undefined, index)}
            >
              <button
                id={`tab-${group.id}-${index}`}
                role="tab"
                tabIndex={group.active === p ? 0 : -1}
                aria-selected={group.active === p}
                onKeyDown={(e) => {
                  if (
                    ["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)
                  ) {
                    e.preventDefault();
                    const i =
                      e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? group.tabs.length - 1
                          : (index +
                              (e.key === "ArrowRight"
                                ? 1
                                : group.tabs.length - 1)) %
                            group.tabs.length;
                    safe(async () => {
                      await model.open(group.tabs[i], group.id);
                      document.getElementById(`tab-${group.id}-${i}`)?.focus();
                    });
                  }
                  if (e.key === "Delete") {
                    e.preventDefault();
                    closeTab(p, group.id);
                  }
                }}
                title={p}
                onClick={() => safe(() => model.open(p, group.id))}
              >
                {p.split("/").pop()}
                {model.dirty(model.docs.get(p)!) ? " •" : ""}
              </button>
              <button
                tabIndex={group.active === p ? 0 : -1}
                aria-label={`Close ${p}`}
                onClick={() => closeTab(p, group.id)}
              >
                ×
              </button>
            </div>
          ))}
          {!group.tabs.length && (
            <span className="subtle">Drop or open a file</span>
          )}
        </div>
        {d?.conflict && (
          <div className="editor-conflict" role="alert">
            {d.conflict}
            <button onClick={() => safe(() => inspectConflict(d.path))}>
              Compare / resolve
            </button>
          </div>
        )}
        <div
          className="editor-content"
          onDragOver={(e) => e.preventDefault()}
          onDrop={(e) => drop(e, group.id)}
        >
          {d ? (
            <CodePane model={model} group={group} />
          ) : (
            <div className="editor-empty">
              <h2>Your code, in focus</h2>
              <p>Open a file from Explorer or use Quick Open.</p>
              <button onClick={() => openPopup("quick")}>
                Quick Open · ⌘ / Ctrl P
              </button>
            </div>
          )}
          {dragging && (
            <div className="drop-edges">
              <div
                className="drop-center"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => drop(e, group.id)}
              >
                Move here
              </div>
              <div
                className="drop-right"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => drop(e, group.id, "row")}
              >
                Split right
              </div>
              <div
                className="drop-bottom"
                onDragOver={(e) => e.preventDefault()}
                onDrop={(e) => drop(e, group.id, "column")}
              >
                Split down
              </div>
            </div>
          )}
        </div>
        <footer className="editor-status">
          {group.active ?? "No file"}
          <span>
            {d?.saving ? "Saving…" : d && model.dirty(d) ? "Unsaved" : "Saved"}{" "}
            · UTF-8 · {d?.state.lineBreak === "\r\n" ? "CRLF" : "LF"}
          </span>
        </footer>
      </section>
    );
  }
  function renderLayout(node: Layout): ReactNode {
    if ("group" in node) return groupView(model.group(node.group));
    return (
      <div className={`editor-split ${node.axis}`} key={node.id}>
        <div style={{ flexBasis: `${node.ratio}%` }}>
          {renderLayout(node.first)}
        </div>
        <div
          className="split-handle"
          role="separator"
          aria-label="Resize editor groups"
          aria-orientation={node.axis === "row" ? "vertical" : "horizontal"}
          aria-valuemin={15}
          aria-valuemax={85}
          aria-valuenow={Math.round(node.ratio)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (
              ["ArrowLeft", "ArrowUp", "ArrowRight", "ArrowDown"].includes(
                e.key,
              )
            ) {
              e.preventDefault();
              model.resize(
                node.id,
                node.ratio +
                  (["ArrowRight", "ArrowDown"].includes(e.key) ? 5 : -5),
              );
            }
          }}
          onPointerDown={(e) => {
            const handle = e.currentTarget,
              rect = handle.parentElement!.getBoundingClientRect();
            handle.setPointerCapture(e.pointerId);
            const move = (ev: PointerEvent) =>
              model.resize(
                node.id,
                node.axis === "row"
                  ? (100 * (ev.clientX - rect.left)) / rect.width
                  : (100 * (ev.clientY - rect.top)) / rect.height,
              );
            const end = () => {
              handle.removeEventListener("pointermove", move);
              handle.removeEventListener("pointerup", end);
              handle.removeEventListener("pointercancel", end);
            };
            handle.addEventListener("pointermove", move);
            handle.addEventListener("pointerup", end);
            handle.addEventListener("pointercancel", end);
          }}
        />
        <div style={{ flexBasis: `${100 - node.ratio}%` }}>
          {renderLayout(node.second)}
        </div>
      </div>
    );
  }
  const files = state.files.filter((p) =>
    p.toLowerCase().includes(query.toLowerCase()),
  );
  return (
    <section
      className="ide-workspace"
      aria-label="IDE workspace"
      hidden={!visible}
    >
      <div className="ide-toolbar">
        <h1>Editor</h1>
        <button onClick={() => setSidebar((x) => !x)}>Explorer</button>
        <button onClick={() => openPopup("quick")}>Quick Open</button>
        <button onClick={() => openPopup("commands")}>Commands</button>
        <span />
        {commands
          .filter((c) =>
            ["Save", "Save All", "Split Right", "Split Down"].includes(c.name),
          )
          .map((c) => (
            <button key={c.name} onClick={() => safe(c.run)}>
              {c.name}
            </button>
          ))}
      </div>
      {model.error && (
        <div className="error-banner" role="alert">
          {model.error}
          <button
            aria-label="Dismiss editor error"
            onClick={() => {
              model.error = "";
              model.emit();
            }}
          >
            ×
          </button>
        </div>
      )}
      {trash && (
        <div className="editor-notice">
          Moved to workspace recovery trash.
          <button
            onClick={() =>
              safe(async () => {
                await api("restoreFile", { trash });
                setTrash(undefined);
                onRefresh();
                await model.checkExternal();
              })
            }
          >
            Undo delete
          </button>
          <button onClick={() => setTrash(undefined)}>Dismiss</button>
        </div>
      )}
      <div className="ide-body">
        {sidebar && (
          <aside className="ide-explorer" aria-label="Explorer">
            <div className="explorer-actions">
              <button onClick={() => openPopup("create")}>New file</button>
              <button onClick={() => openPopup("folder")}>New folder</button>
            </div>
            <input
              aria-label={search ? "Search file contents" : "Filter files"}
              placeholder={search ? "Search file contents…" : "Filter files…"}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <label>
              <input
                type="checkbox"
                checked={search}
                onChange={(e) => setSearch(e.target.checked)}
              />{" "}
              Search contents
            </label>
            {state.index.limited && (
              <p role="status">
                Index limited to {state.index.limit} entries /{" "}
                {state.index.depth} levels. Use an exact path in Quick Open.
              </p>
            )}
            <div className="explorer-files">
              {search ? (
                (results?.hits.map((h: any, i: number) => (
                  <button
                    key={i}
                    onClick={() =>
                      safe(async () => {
                        await model.open(h.path);
                        const d = model.docs.get(h.path)!;
                        const line = d.state.doc.line(
                          Math.min(h.line, d.state.doc.lines),
                        );
                        model.views.get(model.focused)?.dispatch({
                          selection: { anchor: line.from },
                          scrollIntoView: true,
                        });
                      })
                    }
                  >
                    {h.path}:{h.line}
                    <small>{h.text}</small>
                  </button>
                )) ?? <p>{query ? "Searching…" : "Enter text to search"}</p>)
              ) : (
                <>
                  {state.index.directories
                    .filter((p) =>
                      p.toLowerCase().includes(query.toLowerCase()),
                    )
                    .map((p) => (
                      <button
                        className={selected === p ? "selected" : ""}
                        key={p}
                        onClick={() => setSelected(p)}
                        title={p}
                      >
                        ▸ {p}/
                      </button>
                    ))}
                  {files.map((p) => (
                    <button
                      className={selected === p ? "selected" : ""}
                      key={p}
                      title={p}
                      draggable
                      onDragStart={(e) => {
                        e.dataTransfer.setData(
                          "application/x-nexus-file",
                          JSON.stringify({ path: p }),
                        );
                        setDragging(true);
                      }}
                      onDragEnd={() => setDragging(false)}
                      onClick={() => {
                        setSelected(p);
                        safe(() => model.open(p));
                      }}
                    >
                      ◇ {p}
                    </button>
                  ))}
                  {!files.length && <p>No matching files</p>}
                </>
              )}
              {results?.limited && (
                <p>Search reached its 100-result or workspace index limit.</p>
              )}
            </div>
            <div className="explorer-selection" title={selected}>
              {selected || "Select a file or folder"}
            </div>
            <div className="explorer-actions">
              <button disabled={!selected} onClick={() => openPopup("rename")}>
                Rename
              </button>
              <button disabled={!selected} onClick={() => openPopup("delete")}>
                Delete
              </button>
            </div>
          </aside>
        )}
        <div className="editors">{renderLayout(model.layout)}</div>
        <aside className="ide-assistant" aria-label="Contextual assistance">
          <h2>File assistant</h2>
          <p>{active ? active.path : "Select a file to provide context"}</p>
          <p className="subtle">
            Uses the active selection, or the file. Focused edits are reviewed
            before applying.
          </p>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              safe(assist);
            }}
          >
            <textarea
              aria-label="Ask about active file"
              placeholder="Explain this selection or describe a focused edit…"
              value={instruction}
              onChange={(e) => setInstruction(e.target.value)}
            />
            <button disabled={assisting || !instruction.trim()}>
              {assisting ? "Requesting…" : "Ask with context"}
            </button>
          </form>
          {run?.mode === "ide" && (
            <div className="ide-assistant-result">
              <p>IDE request · {run.status.replaceAll("_", " ")}</p>
              <Approval run={run} busy={deciding} onDecision={onDecision} />
              <Changes run={run} />
              <Overview run={run} />
            </div>
          )}
          <label>
            <input
              type="checkbox"
              checked={autosave}
              onChange={(e) => setAutosave(e.target.checked)}
            />{" "}
            Autosave after 1.5 s idle
          </label>
          <p className="subtle">
            {window.nexusDesktop
              ? "Syntax highlighting, search and document commands are included. Language services, an interactive terminal and debugging are not yet included in the desktop app."
              : "Browser editing: syntax, search and document commands. Full language services, terminal and debugging are available in your VS Code host."}
          </p>
        </aside>
      </div>
      <div className="ide-bottom" role="status">
        <span>
          {model.notice ||
            `${model.docs.size} documents · ${model.groups.length} groups`}
        </span>
        <span>{model.recovery}</span>
      </div>
      {closing && (
        <Modal title="Unsaved changes" close={() => setClosing(undefined)}>
          <p>Save changes to {closing.path} before closing the last view?</p>
          <div className="dialog-actions">
            <button onClick={() => setClosing(undefined)}>Cancel</button>
            <button
              onClick={() => {
                model.close(closing.path, closing.group);
                setClosing(undefined);
              }}
            >
              Discard
            </button>
            <button
              onClick={() =>
                safe(async () => {
                  await model.save(closing.path);
                  model.close(closing.path, closing.group);
                  setClosing(undefined);
                })
              }
            >
              Save and close
            </button>
          </div>
        </Modal>
      )}
      {conflict && (
        <Modal
          title="Resolve external change"
          close={() => setConflict(undefined)}
        >
          <p>
            {conflict.path} ·{" "}
            {conflict.content === null
              ? "Deleted on disk"
              : "Current disk contents"}
          </p>
          <pre>{conflict.content ?? "(file missing)"}</pre>
          <p>
            Your buffer stays open until you choose. Keep my edits replaces
            exactly this reviewed disk version.
          </p>
          <div className="dialog-actions">
            <button onClick={() => setConflict(undefined)}>Cancel</button>
            <button
              onClick={() =>
                safe(async () => {
                  await model.reload(conflict.path);
                  setConflict(undefined);
                })
              }
            >
              Discard edits and reload
            </button>
            <button
              onClick={() =>
                safe(async () => {
                  await model.keepMine(conflict.path, conflict.content);
                  setConflict(undefined);
                })
              }
            >
              Keep my edits
            </button>
          </div>
        </Modal>
      )}
      {popup && (
        <Modal
          title={
            popup === "quick"
              ? "Quick Open"
              : popup === "commands"
                ? "Command palette"
                : popup === "delete"
                  ? "Delete to recovery trash"
                  : `${popup === "create" ? "New file" : popup === "folder" ? "New folder" : "Rename"} in workspace`
          }
          close={() => {
            if (!opBusy) setPopup(undefined);
          }}
        >
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (popup === "quick")
                safe(async () => {
                  await model.open(input);
                  setPopup(undefined);
                });
              else if (popup !== "commands") void fileOp();
            }}
          >
            {popup === "delete" ? (
              <p>
                Move {selected} to .nexus/trash? It can be restored using Undo
                delete.
              </p>
            ) : (
              <input
                autoFocus
                aria-label={
                  popup === "commands"
                    ? "Find a command"
                    : popup === "quick"
                      ? "Find or enter file path"
                      : "Workspace path"
                }
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Type to search…"
              />
            )}
            {popup === "quick" ? (
              <div className="quick-results">
                {state.files
                  .filter((p) => p.toLowerCase().includes(input.toLowerCase()))
                  .slice(0, 100)
                  .map((p) => (
                    <button
                      type="button"
                      key={p}
                      onClick={() =>
                        safe(async () => {
                          await model.open(p);
                          setPopup(undefined);
                        })
                      }
                    >
                      {p}
                    </button>
                  ))}
                <small>
                  First 100 matches. Enter an exact path to open beyond the
                  index.
                </small>
              </div>
            ) : popup === "commands" ? (
              <div className="quick-results">
                {commands
                  .filter((c) =>
                    c.name.toLowerCase().includes(input.toLowerCase()),
                  )
                  .map((c) => (
                    <button
                      type="button"
                      key={c.name}
                      onClick={() => {
                        setPopup(undefined);
                        safe(c.run);
                      }}
                    >
                      {c.name}
                    </button>
                  ))}
              </div>
            ) : (
              <>
                {opError && <p role="alert">{opError}</p>}
                <div className="dialog-actions">
                  <button
                    type="button"
                    disabled={opBusy}
                    onClick={() => setPopup(undefined)}
                  >
                    Cancel
                  </button>
                  <button
                    disabled={opBusy || (!input.trim() && popup !== "delete")}
                  >
                    {opBusy
                      ? "Working…"
                      : popup === "delete"
                        ? "Move to trash"
                        : "Confirm"}
                  </button>
                </div>
              </>
            )}
          </form>
        </Modal>
      )}
    </section>
  );
}
