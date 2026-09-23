import type { EvalResult, Run, TraceEvent } from "./types";
export function evaluate(
  run: Run,
  events: TraceEvent[],
  integrity: boolean,
): EvalResult {
  const actualTools = events.filter(
    (e) => e.type === "tool_result" && !(e.data.result as any)?.error,
  );
  const approvals = events.filter((e) => e.type === "approval");
  const tests = run.tests.length
    ? run.tests.every((t) => t.exitCode === 0)
    : null;
  const checks = [
    { name: "Run completed", passed: run.status === "completed" },
    { name: "Trace chain intact", passed: integrity },
    {
      name: "Plan recorded",
      passed: run.mode === "agent" ? run.plan.length > 0 : null,
    },
    { name: "Tests passed", passed: tests },
    { name: "Budget respected", passed: run.cost <= run.budget },
    {
      name: "Mutations approved",
      passed: !actualTools.some(
        (e) =>
          ["propose_edits", "run_tests", "git_commit", "browser"].includes(
            String(e.data.name),
          ) &&
          !approvals.some(
            (a) => a.data.callId === e.data.callId && a.data.approved === true,
          ),
      ),
    },
  ];
  const scored = checks.filter((c) => c.passed !== null);
  return {
    runId: run.id,
    status: run.status,
    score: Math.round(
      (scored.filter((c) => c.passed).length / scored.length) * 100,
    ),
    verified: run.status === "completed" && tests === true && integrity,
    checks,
    cost: run.cost,
    tokens: run.inputTokens + run.outputTokens,
    latencyMs: run.modelTimeMs,
    blockedActions: events.filter((e) => e.type === "policy_block").length,
  };
}
