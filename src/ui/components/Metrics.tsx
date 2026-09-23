import { useEffect, useState } from "react";
import { api } from "../api";
import type { EvalResult } from "../../core/types";
export function Metrics({ onSelect }: { onSelect: (id: string) => void }) {
  const [rows, setRows] = useState<
      (EvalResult & { prompt: string; modelId: string })[]
    >([]),
    [error, setError] = useState("");
  useEffect(() => {
    void api("metrics")
      .then(setRows)
      .catch((e) => setError(e.message));
  }, []);
  return (
    <section className="metrics-view">
      <h1>Run evaluations</h1>
      <p className="subtle">
        Deterministic checks from real execution traces. A completed response is
        verified only when tests pass.
      </p>
      <div className="metric-totals">
        <div>
          <span>Runs</span>
          <strong>{rows.length}</strong>
        </div>
        <div>
          <span>Verified by tests</span>
          <strong>{rows.filter((r) => r.verified).length}</strong>
        </div>
        <div>
          <span>API cost</span>
          <strong>${rows.reduce((s, r) => s + r.cost, 0).toFixed(4)}</strong>
        </div>
      </div>
      {error && <p className="error-detail">{error}</p>}
      {rows.length ? (
        <div className="table-scroll">
          <table>
            <thead>
              <tr>
                <th>Task</th>
                <th>Model</th>
                <th>Score</th>
                <th>Verified</th>
                <th>Cost</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.runId}>
                  <td>
                    <button onClick={() => onSelect(r.runId)}>
                      {r.prompt}
                    </button>
                  </td>
                  <td>{r.modelId ?? "—"}</td>
                  <td>{r.score}%</td>
                  <td>{r.verified ? "Yes" : "No"}</td>
                  <td>${r.cost.toFixed(4)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="inline-empty">
          <h3>No evaluations yet</h3>
          <p>Complete your first task to see its execution checks here.</p>
        </div>
      )}
    </section>
  );
}
