import { getSearchQuery } from "@codemirror/search";
import {
  EditorState,
  EditorSelection,
  Transaction,
  Compartment,
} from "@codemirror/state";
import { EditorView, keymap } from "@codemirror/view";
import { basicSetup } from "codemirror";
import { indentWithTab } from "@codemirror/commands";
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { oneDark } from "@codemirror/theme-one-dark";
import { javascript } from "@codemirror/lang-javascript";
import { json } from "@codemirror/lang-json";
import { python } from "@codemirror/lang-python";
import { html } from "@codemirror/lang-html";
import { css } from "@codemirror/lang-css";
import { markdown } from "@codemirror/lang-markdown";
import { api, recoveryId, cacheRecovery, cachedRecovery } from "../api";

export interface Doc {
  path: string;
  state: EditorState;
  before: string | null;
  conflict?: string;
  saving?: Promise<void>;
}
export interface Group {
  id: string;
  tabs: string[];
  active?: string;
  positions: Record<
    string,
    { selection: ReturnType<EditorSelection["toJSON"]>; scroll: number }
  >;
}
export type Layout =
  | { group: string }
  | {
      id: string;
      axis: "row" | "column";
      ratio: number;
      first: Layout;
      second: Layout;
    };
export const leaves = (n: Layout): string[] =>
  "group" in n ? [n.group] : [...leaves(n.first), ...leaves(n.second)];
const theme = EditorView.theme({
  "&": { height: "100%", fontSize: "13px" },
  ".cm-scroller": {
    overflow: "auto",
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
  },
  ".cm-content": { minHeight: "100%" },
  "&.cm-focused": { outline: "none" },
});
function language(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext && ["js", "jsx", "ts", "tsx", "mjs", "cjs"].includes(ext)
    ? javascript({ typescript: ext.includes("ts"), jsx: ext.endsWith("x") })
    : ext === "json"
      ? json()
      : ext === "py"
        ? python()
        : ext === "html"
          ? html()
          : ext === "css"
            ? css()
            : ext === "md"
              ? markdown()
              : [];
}
export class EditorModel {
  docs = new Map<string, Doc>();
  groups: Group[] = [{ id: "main", tabs: [], positions: {} }];
  layout: Layout = { group: "main" };
  focused = "main";
  views = new Map<string, EditorView>();
  version = 0;
  private listeners = new Set<() => void>();
  error = "";
  notice = "";
  loaded = false;
  recovery = "Loading recovery…";
  private persistTimer?: ReturnType<typeof setTimeout>;
  private persistChain = Promise.resolve();
  private revision = 0;
  private savedRevision = 0;
  wrap = false;
  private wrapConfig = new Compartment();
  private labelConfig = new Compartment();
  private languageConfig = new Compartment();
  private opening = new Map<string, Promise<void>>();
  private openIntents = new Map<string, number>();
  private focusIntent = 0;
  private disposed = false;
  constructor(readonly workspace: string) {}
  subscribe = (f: () => void) => {
    this.listeners.add(f);
    return () => {
      this.listeners.delete(f);
    };
  };
  snapshot = () => this.version;
  emit = () => {
    this.version++;
    this.listeners.forEach((f) => f());
  };
  fail = (e: unknown) => {
    this.error = e instanceof Error ? e.message : String(e);
    this.emit();
  };
  group(id = this.focused) {
    return this.groups.find((g) => g.id === id) ?? this.groups[0];
  }
  active() {
    return this.docs.get(this.group().active ?? "");
  }
  dirty(d: Doc) {
    return d.state.sliceDoc() !== (d.before ?? "");
  }
  make(path: string, content: string, before: string | null): Doc {
    return {
      path,
      before,
      state: EditorState.create({
        doc: content,
        extensions: [
          syntaxHighlighting(
            HighlightStyle.define([{ tag: tags.comment, color: "#a6b2c5" }]),
          ),
          EditorView.updateListener.of((update) => {
            const panel = update.view.dom.querySelector(".cm-search");
            if (!panel) return;
            const query = getSearchQuery(update.state),
              invalid = query.regexp && !!query.search && !query.valid;
            let status = panel.querySelector<HTMLElement>(".search-error");
            if (invalid && !status) {
              status = document.createElement("span");
              status.className = "search-error";
              status.setAttribute("role", "alert");
              panel.append(status);
            }
            if (status) {
              status.textContent = invalid ? "Invalid regular expression" : "";
              status.hidden = !invalid;
            }
            panel
              .querySelector('input[name="search"]')
              ?.setAttribute("aria-invalid", String(invalid));
          }),
          basicSetup,
          oneDark,
          theme,
          this.languageConfig.of(language(path)),
          keymap.of([indentWithTab]),
          this.wrapConfig.of(this.wrap ? EditorView.lineWrapping : []),
          EditorState.lineSeparator.of(
            content.includes("\r\n") ? "\r\n" : "\n",
          ),
          this.labelConfig.of(
            EditorView.contentAttributes.of({ "aria-label": `Edit ${path}` }),
          ),
        ],
      }),
    };
  }
  async init() {
    try {
      const disk = await api("editorSession", {
          id: recoveryId(this.workspace),
        }),
        cache = cachedRecovery(this.workspace);
      const saved = cache?.time > (disk?.time ?? 0) ? cache : disk;
      if (saved?.schema === 1) {
        for (const d of saved.docs ?? [])
          if (typeof d.path === "string" && typeof d.content === "string")
            this.docs.set(d.path, this.make(d.path, d.content, d.before));
        if (saved.groups?.length && saved.groups.length <= 4) {
          this.groups = saved.groups;
          this.layout = saved.layout;
          this.focused = saved.focused;
        }
        this.notice = this.docs.size
          ? "Restored editor session. Unsaved content is recovered; undo history starts here."
          : "";
      }
      this.loaded = true;
      this.recovery = "Recovery ready";
      await this.checkExternal();
      this.emit();
    } catch (e) {
      this.loaded = true;
      this.recovery = "Recovery unavailable";
      this.fail(e);
    }
  }
  changed() {
    this.revision++;
    this.recovery = "Saving recovery…";
    this.emit();
    this.schedulePersistence();
  }
  capture() {
    for (const [id, view] of this.views) {
      const g = this.group(id);
      if (g.active)
        g.positions[g.active] = {
          selection: view.state.selection.toJSON(),
          scroll: view.scrollDOM.scrollTop,
        };
    }
    return {
      schema: 1,
      time: Date.now(),
      docs: [...this.docs.values()].map((d) => ({
        path: d.path,
        before: d.before,
        content: d.state.sliceDoc(),
      })),
      groups: this.groups,
      layout: this.layout,
      focused: this.focused,
    };
  }
  schedulePersistence() {
    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => void this.persist(), 120);
  }
  persist() {
    clearTimeout(this.persistTimer);
    const snapshot = this.capture(),
      revision = this.revision;
    cacheRecovery(this.workspace, snapshot);
    this.persistChain = this.persistChain.then(async () => {
      try {
        await api("editorSession", {
          id: recoveryId(this.workspace),
          session: snapshot,
        });
        this.savedRevision = revision;
        this.recovery =
          revision === this.revision ? "Recovery saved" : "Saving recovery…";
      } catch (e) {
        this.recovery = "Recovery failed — keep this window open";
        this.fail(e);
      }
      this.emit();
    });
    return this.persistChain;
  }
  async open(path: string, group = this.focused) {
    if (!this.loaded) throw new Error("Wait for editor recovery to finish");
    const g = this.group(group);
    const intent = (this.openIntents.get(g.id) ?? 0) + 1;
    this.openIntents.set(g.id, intent);
    const focusIntent = ++this.focusIntent;
    if (!this.docs.has(path)) {
      if (!this.opening.has(path)) {
        if (this.docs.size + this.opening.size >= 100)
          throw new Error(
            "100 open documents supported. Close a document first.",
          );
        const load = (async () => {
          const r = await api("file", { path });
          this.docs.set(path, this.make(path, r.content, r.content));
        })();
        this.opening.set(path, load);
      }
      try {
        await this.opening.get(path);
      } finally {
        this.opening.delete(path);
      }
    }
    if (!this.groups.includes(g)) {
      if (!this.groups.some((other) => other.tabs.includes(path)))
        this.docs.delete(path);
      return;
    }
    if (!g.tabs.includes(path)) g.tabs.push(path);
    if (this.openIntents.get(g.id) === intent) g.active = path;
    if (this.focusIntent === focusIntent) this.focused = g.id;
    this.changed();
  }
  focus(id: string) {
    if (this.focused !== id) {
      this.focusIntent++;
      this.focused = id;
      this.emit();
    }
  }
  update(id: string, path: string, tr: Transaction, source: EditorView) {
    // Deferred focus/search transactions can arrive after a view is destroyed.
    // They must not replace the document or position owned by its newer view.
    if (this.views.get(id) !== source) return;
    const g = this.group(id),
      d = this.docs.get(path);
    if (!d) return;
    source.update([tr]);
    g.positions[d.path] = {
      selection: tr.state.selection.toJSON(),
      scroll: source?.scrollDOM.scrollTop ?? 0,
    };
    if (tr.docChanged) {
      d.state = tr.state;
      for (const other of this.groups) {
        if (other.id === id) continue;
        const position = other.positions[d.path];
        if (position)
          position.selection = EditorSelection.fromJSON(position.selection)
            .map(tr.changes)
            .toJSON();
        if (other.active === d.path) {
          const view = this.views.get(other.id);
          if (view) {
            const selection = view.state.selection.map(tr.changes),
              scroll = view.scrollDOM.scrollTop;
            view.setState(
              d.state.update({
                selection,
                annotations: Transaction.addToHistory.of(false),
              }).state,
            );
            view.scrollDOM.scrollTop = scroll;
          }
        }
      }
      this.changed();
    } else {
      d.state = tr.state;
      this.schedulePersistence();
    }
  }
  renameDocument(old: string, next: string) {
    const d = this.docs.get(old);
    if (!d) return;
    this.docs.delete(old);
    d.path = next;
    d.state = d.state.update({
      effects: [
        this.labelConfig.reconfigure(
          EditorView.contentAttributes.of({ "aria-label": `Edit ${next}` }),
        ),
        this.languageConfig.reconfigure(language(next)),
      ],
    }).state;
    this.docs.set(next, d);
    for (const g of this.groups) {
      g.tabs = g.tabs.map((t) => (t === old ? next : t));
      if (g.active === old) g.active = next;
      if (g.positions[old]) {
        g.positions[next] = g.positions[old];
        delete g.positions[old];
      }
    }
  }
  toggleWrap() {
    this.wrap = !this.wrap;
    for (const d of this.docs.values())
      d.state = d.state.update({
        effects: this.wrapConfig.reconfigure(
          this.wrap ? EditorView.lineWrapping : [],
        ),
      }).state;
    for (const [id, v] of this.views) {
      const d = this.docs.get(this.group(id).active!)!;
      v.setState(
        d.state.update({
          selection: v.state.selection,
          annotations: Transaction.addToHistory.of(false),
        }).state,
      );
    }
    this.emit();
  }
  async save(path = this.group().active): Promise<void> {
    if (!path) return;
    const d = this.docs.get(path)!;
    if (d.saving) {
      await d.saving;
      if (this.dirty(d)) return this.save(path);
      return;
    }
    if (!this.dirty(d)) return;
    const content = d.state.sliceDoc(),
      before = d.before;
    d.saving = (async () => {
      await api("saveFile", { path, before, content });
      d.before = content;
      d.conflict = undefined;
      this.notice = `Saved ${path}`;
    })().finally(() => {
      d.saving = undefined;
      this.changed();
    });
    this.emit();
    await d.saving;
  }
  async saveAll() {
    for (const d of this.docs.values())
      if (this.dirty(d)) await this.save(d.path);
  }
  close(path: string, id = this.focused) {
    const g = this.group(id);
    g.tabs = g.tabs.filter((p) => p !== path);
    delete g.positions[path];
    if (g.active === path) g.active = g.tabs.at(-1);
    if (!this.groups.some((g) => g.tabs.includes(path))) this.docs.delete(path);
    this.changed();
  }
  isLastView(path: string) {
    return this.groups.filter((g) => g.tabs.includes(path)).length === 1;
  }
  split(id = this.focused, axis: "row" | "column" = "row", file?: string) {
    if (this.groups.length >= 4)
      throw new Error("Up to four editor groups are supported.");
    const source = this.group(id),
      next: Group = { id: crypto.randomUUID(), tabs: [], positions: {} };
    const p = file ?? source.active;
    if (p && this.docs.has(p)) {
      next.tabs = [p];
      next.active = p;
      next.positions = structuredClone(source.positions);
    }
    this.groups.push(next);
    const insert = (n: Layout): Layout =>
      "group" in n
        ? n.group === id
          ? {
              id: crypto.randomUUID(),
              axis,
              ratio: 50,
              first: n,
              second: { group: next.id },
            }
          : n
        : { ...n, first: insert(n.first), second: insert(n.second) };
    this.layout = insert(this.layout);
    this.focused = next.id;
    this.changed();
    return next.id;
  }
  closeGroup(id = this.focused) {
    if (this.groups.length === 1) return;
    const old = this.group(id),
      dest = this.groups.find((g) => g.id !== id)!;
    for (const p of old.tabs) if (!dest.tabs.includes(p)) dest.tabs.push(p);
    dest.active ??= dest.tabs[0];
    const remove = (n: Layout): Layout | undefined => {
      if ("group" in n) return n.group === id ? undefined : n;
      const a = remove(n.first),
        b = remove(n.second);
      return a && b ? { ...n, first: a, second: b } : (a ?? b);
    };
    this.layout = remove(this.layout)!;
    this.groups = this.groups.filter((g) => g.id !== id);
    this.focused = dest.id;
    this.changed();
  }
  move(path: string, from: string, to: string, index?: number) {
    const source = this.group(from),
      dest = this.group(to);
    if (source === dest) {
      dest.tabs = dest.tabs.filter((p) => p !== path);
      dest.tabs.splice(index ?? dest.tabs.length, 0, path);
    } else {
      if (!dest.tabs.includes(path))
        dest.tabs.splice(index ?? dest.tabs.length, 0, path);
      source.tabs = source.tabs.filter((p) => p !== path);
      if (source.active === path) source.active = source.tabs.at(-1);
    }
    dest.active = path;
    this.focused = to;
    this.changed();
  }
  resize(id: string, ratio: number) {
    const walk = (n: Layout): Layout =>
      "group" in n
        ? n
        : {
            ...n,
            ratio: n.id === id ? Math.min(85, Math.max(15, ratio)) : n.ratio,
            first: walk(n.first),
            second: walk(n.second),
          };
    this.layout = walk(this.layout);
    this.changed();
  }
  async checkExternal() {
    if (!this.docs.size) return;
    const before = new Map([...this.docs].map(([p, d]) => [p, d.before]));
    const snapshots = await api("fileSnapshots", {
      paths: [...this.docs.keys()],
    });
    for (const r of snapshots) {
      const d = this.docs.get(r.path);
      if (!d || d.saving || d.before !== before.get(r.path)) continue;
      if (r.error) {
        d.conflict = r.error;
        continue;
      }
      if (r.content === d.before) {
        d.conflict = undefined;
        continue;
      }
      if (this.dirty(d) || r.content === null) {
        d.conflict =
          r.content === null
            ? "File was deleted externally. Save to recreate it only after reviewing."
            : "File changed externally. Your edits are preserved. Compare before saving.";
      } else {
        this.replace(d, r.content);
        d.before = r.content;
        this.notice = `Reloaded external change: ${d.path}`;
      }
    }
    this.emit();
  }
  replace(d: Doc, content: string) {
    const tr = d.state.update({
      changes: { from: 0, to: d.state.doc.length, insert: content },
    });
    d.state = tr.state;
    for (const g of this.groups) {
      delete g.positions[d.path];
      if (g.active === d.path) this.views.get(g.id)?.setState(d.state);
    }
    this.changed();
  }
  async reload(path: string) {
    const r = await api("fileSnapshots", { paths: [path] });
    if (r[0].error) throw new Error(r[0].error);
    const d = this.docs.get(path)!;
    this.replace(d, r[0].content ?? "");
    d.before = r[0].content;
    d.conflict = undefined;
    this.changed();
  }
  async keepMine(path: string, reviewed: string | null) {
    const d = this.docs.get(path)!,
      content = d.state.sliceDoc();
    await api("saveFile", { path, before: reviewed, content });
    d.before = content;
    d.conflict = undefined;
    this.changed();
  }
  dispose() {
    this.disposed = true;
    clearTimeout(this.persistTimer);
    for (const v of this.views.values()) v.destroy();
    this.views.clear();
  }
}
