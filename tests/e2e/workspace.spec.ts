import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
const context = async () =>
  JSON.parse(await readFile(process.env.NEXUS_E2E_STATE!, "utf8"));
test("OpenRouter catalog imports a model and persists provider routing controls", async ({
  page,
}) => {
  await page.route("**/api/openrouterCatalog", (route) =>
    route.fulfill({
      json: [
        {
          id: "test/catalog-coder",
          name: "Catalog Coder",
          contextLength: 128000,
          inputCost: 0.25,
          outputCost: 0.5,
          capabilities: ["text", "image"],
          reasoning: true,
        },
      ],
    }),
  );
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
  const details = page
    .locator("details")
    .filter({
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
  const saved = page
    .locator("details")
    .filter({
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
test.beforeEach(async ({ page }) => {
  const c = await context();
  await page.goto(c.url);
  await expect(
    page.getByRole("heading", { name: "What are we building?" }),
  ).toBeVisible();
});
test("review → apply → separately approve tests → verified result → file edit → trace → evaluation", async ({
  page,
}) => {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page
    .getByRole("button", { name: "Try the offline walkthrough" })
    .click();
  await expect(
    page.getByRole("button", { name: "Apply changes", exact: true }),
  ).toBeEnabled();
  const c = await context();
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
  await expect(editor).toHaveValue(/export function fibonacci/);
  const text = await editor.inputValue();
  await editor.fill(text + "\n// Reviewed in NexusIDE\n");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Save", exact: true }),
  ).toBeDisabled();
  expect(
    await readFile(path.join(c.workspace, "src/fibonacci.mjs"), "utf8"),
  ).toContain("// Reviewed in NexusIDE");
  await page.getByRole("button", { name: "Close file" }).click();
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
}) => {
  const c = await context();
  const before = await readFile(
    path.join(c.workspace, "src/fibonacci.mjs"),
    "utf8",
  );
  await page
    .getByRole("button", { name: "Try the offline walkthrough" })
    .click();
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("Completed · review the result")).toBeVisible();
  expect(
    await readFile(path.join(c.workspace, "src/fibonacci.mjs"), "utf8"),
  ).toBe(before);
  await page.getByRole("button", { name: "New task", exact: true }).click();
  await page.getByRole("button", { name: "IDE", exact: true }).click();
  await page.getByLabel("Model", { exact: true }).selectOption("demo");
  await page.getByLabel("Task prompt").fill("Explain this Fibonacci demo");
  await page.getByRole("button", { name: "Send task", exact: true }).click();
  await expect(
    page.getByText(/General chat needs a configured model/),
  ).toBeVisible();
});
test("mobile workspace menu, settings and CLI help are usable without horizontal overflow", async ({
  page,
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
