import { Check, Monitor, FileCode2, ArrowUpRight, Clock3 } from "lucide-react";
import type { RunView, AppState } from "../api";
export function Activity({
  run,
  state,
  onChanges,
}: {
  run?: RunView;
  state?: AppState;
  onChanges: () => void;
}) {
  const result = (name: string) =>
    run?.events.find((e) => e.type === "tool_result" && e.data.name === name);
  const proposed = run?.events.find(
    (e) => e.type === "approval_requested" && e.data.kind === "edits",
  );
  const steps = [
    {
      title: "Plan",
      detail: run?.plan.length
        ? run.plan[0]
        : "Understand the request and outline the approach.",
      event: result("plan"),
    },
    {
      title: "Inspect workspace",
      detail:
        result("list_files") || result("read_file")
          ? "Read accessible project context."
          : "Read relevant files and find existing patterns.",
      event: result("read_file") ?? result("list_files"),
    },
    {
      title: "Propose changes",
      detail: proposed
        ? `Prepared ${run?.pending?.changes?.length ?? run?.changes.length ?? 0} file changes for review.`
        : "Prepare a focused change for your review.",
      event: proposed,
    },
    {
      title: "Verify",
      detail: run?.tests.length
        ? run.tests.at(-1)?.exitCode === 0
          ? "Test command completed successfully."
          : "Tests failed. Review the output."
        : run?.status === "awaiting_approval"
          ? "Awaiting approval"
          : "Verify the result with a test run.",
      event: result("run_tests"),
    },
  ];
  const model = state?.models.find((m) => m.id === run?.modelId);
  const count = run?.pending?.changes?.length ?? run?.changes.length ?? 0;
  return (
    <aside className="activity-panel">
      <h2>Agent activity</h2>
      {run ? (
        <div className="timeline">
          {steps.map((s, i) => (
            <div className={`timeline-step ${s.event ? "done" : ""}`} key={i}>
              <span className="timeline-marker">
                {s.event && <Check size={13} strokeWidth={3} />}
              </span>
              <div>
                <div className="timeline-title">
                  <strong>{s.title}</strong>
                  <time>
                    {s.event
                      ? new Date(s.event.time).toLocaleTimeString([], {
                          hour: "2-digit",
                          minute: "2-digit",
                        })
                      : ""}
                  </time>
                </div>
                <p>{s.detail}</p>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="activity-empty">
          <div className="orbit">
            <span />
          </div>
          <p>Every step, in the open.</p>
          <small>
            Plans, tool calls, and approvals will appear here as your agent
            works.
          </small>
        </div>
      )}
      <div className="router-summary">
        <span className="section-label">Model router</span>
        <div className="router-model">
          <Monitor size={22} />
          <div>
            <strong>{model?.name ?? "Ready to route"}</strong>
            <p>
              {model?.provider === "demo"
                ? "No API calls"
                : (run?.route?.reason ??
                  "Choose a model or let the router decide.")}
            </p>
          </div>
        </div>
        {run && model?.provider !== "demo" && (
          <div className="usage-row">
            <span>${run.cost.toFixed(4)}</span>
            <span>
              {(run.inputTokens + run.outputTokens).toLocaleString()} tokens
            </span>
          </div>
        )}
        <button className="change-summary" onClick={onChanges}>
          <FileCode2 size={20} />
          <span>
            {count} files changed
            <small>
              {run?.pending?.kind === "edits"
                ? "Review required"
                : count
                  ? "Changes applied"
                  : "No pending changes"}
            </small>
          </span>
          <ArrowUpRight size={16} />
        </button>
      </div>
    </aside>
  );
}
