import type { Run, ModelResponse } from "./types";
export const fibonacciCode = `/** Return the nth Fibonacci number, exactly for n = 0 … 78. */
export function fibonacci(n) {
  if (!Number.isInteger(n) || n < 0 || n > 78) {
    throw new RangeError('n must be an integer between 0 and 78');
  }
  let a = 0;
  let b = 1;
  for (let i = 0; i < n; i += 1) {
    [a, b] = [b, a + b];
  }
  return a;
}
`;
export const fibonacciTests = `import test from 'node:test';
import assert from 'node:assert/strict';
import { fibonacci } from '../src/fibonacci.mjs';

test('calculates the Fibonacci sequence', () => {
  assert.deepEqual(Array.from({ length: 11 }, (_, n) => fibonacci(n)),
    [0, 1, 1, 2, 3, 5, 8, 13, 21, 34, 55]);
});
test('handles the largest safe index', () => {
  assert.equal(fibonacci(78), 8944394323791464);
});
test('rejects invalid input', () => {
  for (const n of [-1, 1.5, NaN, Infinity, 79, '5', null]) {
    assert.throws(() => fibonacci(n), RangeError);
  }
});
`;
export function demoResponse(run: Run): ModelResponse {
  if (!/fibonacci|demo/i.test(run.prompt))
    throw new Error(
      "Offline demo supports only the Fibonacci walkthrough. Configure a provider for other tasks.",
    );
  const done = run.messages
    .filter((m) => m.role === "assistant")
    .flatMap((m) => m.calls ?? [])
    .map((c) => c.name);
  const call = (
    name: string,
    args: Record<string, unknown>,
  ): ModelResponse => ({
    content: "",
    calls: [{ id: `demo-${run.steps}`, name, arguments: args }],
    inputTokens: 0,
    outputTokens: 0,
  });
  if (run.mode === "ide")
    return {
      content:
        "Offline demo: I can add a Fibonacci function and three Node.js tests. Switch to Agent mode and run “Add a Fibonacci function” to review the changes. General chat needs a configured model.",
      calls: [],
      inputTokens: 0,
      outputTokens: 0,
    };
  if (!done.includes("plan"))
    return call("plan", {
      steps: [
        "Inspect workspace",
        "Add a validated Fibonacci function and tests",
        "Review and apply the changes",
        "Run the test suite",
      ],
    });
  if (!done.includes("list_files")) return call("list_files", {});
  if (!done.includes("propose_edits"))
    return call("propose_edits", {
      edits: [
        { path: "src/fibonacci.mjs", content: fibonacciCode },
        { path: "test/fibonacci.test.mjs", content: fibonacciTests },
      ],
    });
  if (!run.changes.some((c) => c.applied))
    return {
      content:
        "No new edits were applied. The proposal was rejected or the files already matched.",
      calls: [],
      inputTokens: 0,
      outputTokens: 0,
    };
  if (!done.includes("run_tests")) return call("run_tests", { target: "node" });
  const last = run.tests.at(-1);
  return {
    content:
      last?.exitCode === 0
        ? "Added a Fibonacci function with input validation. All three tests passed. Review the Changes and Trace tabs for the complete record."
        : last
          ? "The changes were applied, but verification failed. Review the test output before using them."
          : "Changes were applied. Test execution was declined, so this run is not verified.",
    calls: [],
    inputTokens: 0,
    outputTokens: 0,
  };
}
