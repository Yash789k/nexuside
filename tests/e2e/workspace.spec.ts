import { test, expect } from "./fixtures";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
test("P01 browser session credential save, replacement and removal update configuration without exposing keys", async ({
  page,
  nexus,
}) => {
  const state = await nexus.request("state");
  const model = state.config.models.find(
    (m: any) => m.provider === "openrouter",
  );
  model.enabled = true;
  model.keyEnv = "NEXUS_QA_TEST_KEY";
  model.baseUrl = "http://127.0.0.1:1"; // No inference is requested by this test.
  await nexus.request("config", { config: state.config });
  await page.reload();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page
    .getByLabel("Credential provider")
    .selectOption("NEXUS_QA_TEST_KEY");
  const key = page.getByLabel("Provider API key", { exact: true });
  await key.fill("short");
  await expect(
    page.getByRole("button", { name: "Save key", exact: true }),
  ).toBeDisabled();
  for (const value of ["fixture-only-key-a", "fixture-only-key-b"]) {
    await key.fill(value);
    await page.getByRole("button", { name: "Save key", exact: true }).click();
    await expect(
      page.getByText("Credential saved.", { exact: true }),
    ).toBeVisible();
    await expect
      .poll(
        async () =>
          (await nexus.request("state")).models.find(
            (m: any) => m.id === model.id,
          ).configured,
      )
      .toBe(true);
    expect(JSON.stringify(await nexus.request("state"))).not.toContain(value);
    await expect(key).toHaveValue("");
  }
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  await expect(
    page.getByText(/Credential removed from this session/),
  ).toBeVisible();
  await expect
    .poll(
      async () =>
        (await nexus.request("state")).models.find(
          (m: any) => m.id === model.id,
        ).configured,
    )
    .toBe(false);
});

test("OpenRouter catalog imports a model and persists provider routing controls", async ({
  page,
  nexus,
}) => {
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await page.getByRole("button", { name: "Load catalog" }).click();
  await page
    .getByRole("textbox", { name: "Search OpenRouter models" })
    .fill("catalog");
  await page
    .getByRole("button", { name: "Add test/catalog-coder", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Added test/catalog-coder" }),
  ).toBeDisabled();
  const details = page.locator("details").filter({
    has: page.locator("summary strong", {
      hasText: "OpenRouter · Catalog Coder",
    }),
  });
  await details.locator("summary").click();
  await details.getByLabel("Optimize for").selectOption("throughput");
  await details.getByLabel("Model preference").selectOption("none");
  await details.getByLabel("Require zero data retention").check();
  await details.getByLabel("Provider data collection").selectOption("deny");
  await details
    .getByLabel("Fallback model IDs")
    .fill("qwen/qwen3-coder, google/gemini-2.5-flash");
  await page.getByRole("button", { name: "Save settings" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  const saved = page.locator("details").filter({
    has: page.locator("summary strong", {
      hasText: "OpenRouter · Catalog Coder",
    }),
  });
  await saved.locator("summary").click();
  await expect(saved.getByLabel("Optimize for")).toHaveValue("throughput");
  await expect(saved.getByLabel("Require zero data retention")).toBeChecked();
  await expect(saved.getByLabel("Fallback model IDs")).toHaveValue(
    "qwen/qwen3-coder, google/gemini-2.5-flash",
  );
});
test("review → apply → separately approve tests → verified result → file edit → trace → evaluation", async ({
  page,
  nexus,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("button", { name: "Try the offline walkthrough" })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply changes", exact: true }),
  ).toBeEnabled();
  const c = nexus;
  await expect(
    readFile(path.join(c.workspace, "src/fibonacci.mjs")),
  ).rejects.toThrow();
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Approve test run", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Approve test run", exact: true })
    .click();
  await expect(page.getByText("Completed and verified")).toBeVisible();
  await page.getByRole("tab", { name: "Overview" }).click();
  await expect(page.getByText("Tests passed", { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Trace", exact: true }).click();
  await expect(page.getByText("Trace integrity verified")).toBeVisible();
  await page
    .getByRole("button", { name: "src/fibonacci.mjs", exact: true })
    .click();
  const editor = page.getByRole("textbox", { name: "Edit src/fibonacci.mjs" });
  await expect(editor).toContainText("export function fibonacci");
  const text = await editor.innerText();
  await editor.fill(text + "\n// Reviewed in NexusIDE\n");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect
    .poll(() => readFile(path.join(c.workspace, "src/fibonacci.mjs"), "utf8"))
    .toContain("// Reviewed in NexusIDE");
  expect(
    await readFile(path.join(c.workspace, "src/fibonacci.mjs"), "utf8"),
  ).toContain("// Reviewed in NexusIDE");
  await page.getByRole("button", { name: "Agent", exact: true }).click();
  await page.getByRole("button", { name: "Evaluations", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Run evaluations" }),
  ).toBeVisible();
  await expect(
    page.getByRole("cell", { name: "100%", exact: true }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});
test("rejecting changes completes without altering existing files; IDE mode responds truthfully", async ({
  page,
  nexus,
}) => {
  const c = nexus;
  await writeFile(path.join(c.workspace, "src-fallback.txt"), "preserved");
  const before = "preserved";
  await page
    .getByRole("button", { name: "Try the offline walkthrough" })
    .click();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("Completed · review the result")).toBeVisible();
  expect(
    await readFile(path.join(c.workspace, "src-fallback.txt"), "utf8"),
  ).toBe(before);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByLabel("Model", { exact: true }).selectOption("fixture");
  await page.getByRole("button", { name: "IDE", exact: true }).click();
  await page.getByLabel("Ask about active file").fill("Explain this file");
  await page.getByRole("button", { name: "Ask with context" }).click();
  await expect(
    page
      .getByLabel("IDE workspace")
      .getByText(
        "Local provider received context. Focused assistance completed.",
      ),
  ).toBeVisible();
});
test("mobile workspace menu, settings and CLI help are usable without horizontal overflow", async ({
  page,
  nexus,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Toggle workspace menu" }).click();
  await page.getByRole("button", { name: "Settings", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Workspace settings" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  await page.getByRole("button", { name: "CLI help", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "NexusIDE in your terminal" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close dialog" }).click();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("A01 a delayed approval clicked in one window cannot approve the next action in another window", async ({
  page,
  nexus,
  context,
}) => {
  await page
    .getByRole("button", { name: "Try the offline walkthrough" })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply changes", exact: true }),
  ).toBeEnabled();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    requested = new Promise<void>((r) => (entered = r));
  await page.route("**/api/decision", async (route) => {
    entered();
    await held;
    await route.continue();
  });
  await page
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await requested;
  const other = await context.newPage();
  await other.goto(nexus.url);
  await other.locator(".run-row").first().click();
  await other
    .getByRole("button", { name: "Apply changes", exact: true })
    .click();
  await expect(
    other.getByRole("button", { name: "Approve test run", exact: true }),
  ).toBeEnabled();
  release();
  await expect(page.getByRole("alert")).toContainText("stale");
  const runs = await nexus.service.engine.store.list(),
    run = runs[0];
  expect(run.pending?.kind).toBe("tests");
  expect(run.tests).toHaveLength(0);
  await other.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(other.getByText("Completed · review the result")).toBeVisible();
  await other.close();
});
test("A02 switching runs waits for an older in-flight response and never renders stale content", async ({
  page,
  nexus,
}) => {
  for (const prompt of ["Queue run A", "Queue run B"]) {
    const r = await nexus.service.engine.create({ prompt, model: "fixture" });
    await nexus.service.engine.drive(r.id);
  }
  await page.reload();
  let release!: () => void, entered!: () => void;
  const held = new Promise<void>((r) => (release = r)),
    started = new Promise<void>((r) => (entered = r));
  let calls = 0;
  await page.route("**/api/run", async (route) => {
    calls++;
    if (calls === 1) {
      entered();
      await held;
    }
    await route.continue();
  });
  await page.locator(".run-row").filter({ hasText: "Queue run A" }).click();
  await started;
  await page.locator(".run-row").filter({ hasText: "Queue run B" }).click();
  await page.waitForTimeout(150);
  expect(calls).toBe(1);
  release();
  await expect(
    page.getByRole("heading", { name: "Queue run B", exact: true }),
  ).toBeVisible();
  expect(calls).toBe(2);
  await expect(
    page.getByRole("heading", { name: "Queue run A", exact: true }),
  ).toHaveCount(0);
});
