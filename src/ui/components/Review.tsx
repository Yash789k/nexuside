import {
  ChevronDown,
  ChevronRight,
  Check,
  Play,
  ShieldCheck,
  Square,
  X,
  GitBranch,
} from "lucide-react";
import { useState } from "react";
import { api, type RunView } from "../api";
import type { Change } from "../../core/types";
export function DiffFile({
  change,
  initialOpen = true,
}: {
  change: Change;
  initialOpen?: boolean;
}) {
  const [open, setOpen] = useState(initialOpen),
    [page, setPage] = useState(0);
  const lines = change.diff.split("\n").slice(4);
  const additions = lines.filter((l) => l.startsWith("+")).length,
    removed = lines.filter((l) => l.startsWith("-")).length;
  let line = 0;
  const start = page * 500,
    end = Math.min(lines.length, start + 500);
  return (
    <div className="diff-file">
      <button
        className="diff-header"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
      >
        {open ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
        <span className="file-badge">
          {change.path.split(".").at(-1)?.slice(0, 3).toUpperCase()}
        </span>
        <span>{change.path}</span>
        <span className="diff-count">
          <b>+{additions}</b>
          <i>−{removed}</i>
        </span>
      </button>
      {open && lines.length > 500 && (
        <div className="diff-pager">
          <span>
            Lines {start + 1}–{end} of {lines.length}
          </span>
          <button disabled={!page} onClick={() => setPage((p) => p - 1)}>
            Previous diff page
          </button>
          <button
            disabled={end >= lines.length}
            onClick={() => setPage((p) => p + 1)}
          >
            Next diff page
          </button>
        </div>
      )}
      {open && (
        <pre className="diff-code">
          {lines.map((text, i) => {
            const meta = text.startsWith("@@") || text.startsWith("\\");
            if (text.startsWith("@@")) {
              const match = text.match(/\+(\d+)/);
              line = Number(match?.[1] ?? 0) - 1;
            } else if (!text.startsWith("-")) line++;
            if (i < start || i >= end) return null;
            return (
              <div
                key={i}
                className={`code-line ${text.startsWith("+") ? "addition" : text.startsWith("-") ? "deletion" : meta ? "meta" : ""}`}
              >
                <span className="line-number">{meta ? "" : line || ""}</span>
                <code>{text || " "}</code>
              </div>
            );
          })}
        </pre>
      )}
    </div>
  );
}
export function Approval({
  run,
  onDecision,
  busy,
}: {
  run: RunView;
  onDecision: (approved: boolean) => void;
  busy: boolean;
}) {
  if (!run.pending || run.status !== "awaiting_approval") return null;
  return (
    <section className="approval">
      <div className="approval-text">
        <span className="dot awaiting_approval" />
        <div>
          <strong>
            {run.pending.kind === "edits"
              ? "Ready for review"
              : run.pending.title}
          </strong>
          <small>
            {run.pending.kind === "edits"
              ? `${run.pending.changes?.length} files changed`
              : run.pending.detail}
          </small>
        </div>
      </div>
      <div className="approval-buttons">
        <button
          className="quiet-button"
          disabled={busy}
          onClick={() => onDecision(false)}
        >
          Reject
        </button>
        <button
          className="primary-button"
          disabled={busy}
          onClick={() => onDecision(true)}
        >
          {run.pending.kind === "edits"
            ? "Apply changes"
            : run.pending.kind === "tests"
              ? "Approve test run"
              : run.pending.kind === "commit"
                ? "Approve commit"
                : "Approve browser"}
        </button>
      </div>
    </section>
  );
}
export function Changes({ run }: { run: RunView }) {
  const changes = run.pending?.changes ?? run.changes;
  return (
    <div className="changes-view">
      {changes.length ? (
        changes.map((c, i) => (
          <DiffFile change={c} key={`${i}-${c.path}`} initialOpen={i === 0} />
        ))
      ) : (
        <div className="inline-empty">
          <GitBranch size={28} />
          <h3>No changes proposed yet</h3>
          <p>File edits will appear here for review.</p>
        </div>
      )}
    </div>
  );
}
export function Overview({ run }: { run: RunView }) {
  const messages = run.messages.filter(
    (m) => m.role === "assistant" && m.content,
  );
  return (
    <div className="overview">
      {run.plan.length > 0 && (
        <section className="plan-section">
          <h3>Plan</h3>
          <ol>
            {run.plan.map((step, i) => (
              <li key={i}>
                <span>{String(i + 1).padStart(2, "0")}</span>
                {step}
              </li>
            ))}
          </ol>
        </section>
      )}
      {messages.map((m, i) => (
        <article className="assistant-message" key={i}>
          <span className="message-label">NexusIDE</span>
          <div className="prose">{m.content}</div>
        </article>
      ))}
      {run.tests.map((t, i) => (
        <section className="test-result" key={i}>
          <header>
            <span
              className={`dot ${t.exitCode === 0 ? "completed" : "failed"}`}
            />
            <strong>
              {t.exitCode === 0 ? "Tests passed" : "Tests failed"}
            </strong>
            <span>
              {t.runner} · {(t.durationMs / 1000).toFixed(1)}s · exit{" "}
              {t.exitCode}
            </span>
          </header>
          <pre>{t.output}</pre>
        </section>
      ))}
      {run.error && <div className="error-detail">{run.error}</div>}
      {!messages.length && !run.plan.length && !run.error && (
        <div className="inline-empty">
          <div className="thinking-dot" />
          <h3>Understanding your task</h3>
          <p>Routing the request and inspecting the workspace.</p>
        </div>
      )}
    </div>
  );
}
export function Trace({ run }: { run: RunView }) {
  const [shot, setShot] = useState<string>();
  const [limit, setLimit] = useState(100);
  return (
    <div className="trace-view">
      <div className="trace-heading">
        <ShieldCheck size={17} />
        <span>
          {run.evaluation.checks.find((c) => c.name === "Trace chain intact")
            ?.passed
            ? "Trace integrity verified"
            : "Trace integrity check failed"}
        </span>
        <button
          onClick={() => {
            const blob = new Blob(
              [run.events.map((e) => JSON.stringify(e)).join("\n")],
              { type: "application/x-ndjson" },
            );
            const link = document.createElement("a");
            link.href = URL.createObjectURL(blob);
            link.download = `nexus-${run.id}.jsonl`;
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 1000);
          }}
        >
          Export JSONL
        </button>
      </div>
      {run.events.slice(0, limit).map((e) => (
        <details className="trace-event" key={e.seq}>
          <summary>
            <span>{String(e.seq).padStart(2, "0")}</span>
            <strong>{e.type.replaceAll("_", " ")}</strong>
            <time>{new Date(e.time).toLocaleTimeString()}</time>
          </summary>
          <pre>{JSON.stringify(e.data, null, 2)}</pre>
          {(e.data.result as any)?.screenshot && (
            <button
              onClick={() =>
                void api("screenshot", {
                  id: (e.data.result as any).screenshot,
                }).then((r) => setShot(r.data))
              }
            >
              View browser screenshot
            </button>
          )}
        </details>
      ))}
      {run.events.length > limit && (
        <button onClick={() => setLimit((n) => n + 100)}>
          Show more events ({limit} of {run.events.length})
        </button>
      )}
      {shot && (
        <div className="browser-evidence">
          <button onClick={() => setShot(undefined)}>Close screenshot</button>
          <img
            alt="Browser execution screenshot"
            src={`data:image/jpeg;base64,${shot}`}
          />
        </div>
      )}
    </div>
  );
}
