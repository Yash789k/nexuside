import { test, expect } from "./fixtures";
import { writeFile, readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import AxeBuilder from "@axe-core/playwright";
const out = path.resolve(process.env.NEXUS_EVIDENCE ?? "../nexuside-qa-evidence");
test("S02 100 real documents, four groups, supported limits, seeded tab navigation and accessibility", async ({
  page,
  nexus,
}, info) => {
  test.setTimeout(150_000);
  await mkdir(out, { recursive: true });
  const latencies: number[] = [],
    errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await mkdir(path.join(nexus.workspace, "tier"));
  await Promise.all(
    Array.from({ length: 101 }, (_, i) =>
      writeFile(
        path.join(
          nexus.workspace,
          "tier",
          `file-${String(i).padStart(3, "0")}.ts`,
        ),
        `// document ${i}\n` + 'export const a = "test";\n'.repeat(20),
      ),
    ),
  );
  await page.reload();
  await page.getByRole("button", { name: "IDE", exact: true }).click();
  await expect(page.getByText("Recovery ready", { exact: true })).toBeVisible();
  for (let i = 0; i < 100; i++) {
    const start = performance.now();
    await page
      .getByRole("button", {
        name: `◇ tier/file-${String(i).padStart(3, "0")}.ts`,
        exact: true,
      })
      .click();
    await expect(
      page.getByRole("textbox", {
        name: `Edit tier/file-${String(i).padStart(3, "0")}.ts`,
      }),
    ).toBeVisible();
    latencies.push(performance.now() - start);
  }
  await page
    .getByRole("button", { name: "◇ tier/file-100.ts", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText("100 open documents");
  for (const name of ["Split Right", "Split Down", "Split Right"])
    await page.getByRole("button", { name, exact: true }).click();
  await expect(page.locator(".editor-group")).toHaveCount(4);
  await page.getByRole("button", { name: "Split Down", exact: true }).click();
  await expect(page.getByRole("alert")).toContainText("four editor groups");
  await page.getByRole("button", { name: "Dismiss editor error" }).click();
  let seed = 230923;
  const steps = [];
  for (let i = 0; i < 50; i++) {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    const n = seed % 100,
      start = performance.now();
    await page
      .getByRole("button", {
        name: `◇ tier/file-${String(n).padStart(3, "0")}.ts`,
        exact: true,
      })
      .click();
    steps.push({ n, ms: performance.now() - start });
  }
  await page.screenshot({
    path: path.join(out, "after-ide-100-documents.png"),
  });
  const axe = await new AxeBuilder({ page }).analyze();
  await writeFile(
    path.join(out, "accessibility-ide.json"),
    JSON.stringify(axe.violations, null, 2),
  );
  await writeFile(
    path.join(out, "stress-editor.json"),
    JSON.stringify(
      {
        seed: 230923,
        open100Ms: latencies,
        randomNavigation: steps,
        errors,
        axeViolations: axe.violations.map((v) => ({
          id: v.id,
          impact: v.impact,
          count: v.nodes.length,
        })),
      },
      null,
      2,
    ),
  );
  expect(errors).toEqual([]);
  expect(
    axe.violations.filter((v) =>
      ["critical", "serious"].includes(v.impact ?? ""),
    ),
  ).toEqual([]);
});
test("V01 actual screenshots, keyboard dialog focus, narrow viewport and reduced motion", async ({
  page,
}) => {
  await mkdir(out, { recursive: true });
  expect(await page.title()).toContain("NexusIDE");
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.screenshot({ path: path.join(out, "after-agent.png") });
  await page.getByRole("button", { name: "IDE", exact: true }).click();
  await page.getByRole("button", { name: "◇ a.ts", exact: true }).click();
  await page.getByRole("button", { name: "Split Right", exact: true }).click();
  await page.screenshot({ path: path.join(out, "after-ide.png") });
  await page.getByRole("button", { name: "Quick Open", exact: true }).click();
  await expect(page.getByLabel("Find or enter file path")).toBeFocused();
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Quick Open", exact: true }),
  ).toBeFocused();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: path.join(out, "after-ide-small.png") });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "New file", exact: true }).click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.screenshot({ path: path.join(out, "after-dialog-small.png") });
  await page.keyboard.press("Escape");
  expect(errors).toEqual([]);
});
test("E06 real pointer edge drop creates a split; invalid and aborted drags do not lose documents", async ({
  page,
}) => {
  await page.getByRole("button", { name: "IDE", exact: true }).click();
  await page.getByRole("button", { name: "◇ a.ts", exact: true }).click();
  await page.getByRole("button", { name: "◇ b.ts", exact: true }).click();
  const tab = page.getByRole("tab", { name: "a.ts", exact: true }),
    box = await tab.boundingBox();
  await page.mouse.move(box!.x + 30, box!.y + 15);
  await page.mouse.down();
  await page.mouse.move(box!.x + 60, box!.y + 100, { steps: 10 });
  await expect(page.locator(".drop-right")).toBeVisible();
  const edge = await page.locator(".drop-right").boundingBox();
  await page.mouse.move(edge!.x + edge!.width / 2, edge!.y + edge!.height / 2, {
    steps: 10,
  });
  await page.mouse.up();
  await expect(page.locator(".editor-group")).toHaveCount(2);
  await expect(
    page.locator(".editor-group").last().getByRole("tab", { name: "a.ts" }),
  ).toBeVisible();
  const now = await page
    .locator(".editor-group")
    .last()
    .getByRole("tab", { name: "a.ts" })
    .boundingBox();
  await page.mouse.move(now!.x + 20, now!.y + 10);
  await page.mouse.down();
  await page.mouse.move(now!.x + 50, now!.y + 70, { steps: 5 });
  await page.keyboard.press("Escape");
  await page.mouse.up();
  await expect(page.locator(".editor-group")).toHaveCount(2);
  await expect(page.getByRole("textbox", { name: "Edit a.ts" })).toBeVisible();
});
test("S03 hundreds of real local runs, long traces and paginated diffs remain inspectable", async ({
  page,
  nexus,
}) => {
  test.setTimeout(180_000);
  const started = performance.now();
  for (let i = 0; i < 200; i++) {
    const r = await nexus.service.engine.create({
      prompt: `History fixture ${i}`,
      model: "fixture",
    });
    await nexus.service.engine.drive(r.id);
  }
  const newest = (await nexus.service.engine.store.list())[0];
  for (let i = 0; i < 350; i++)
    await nexus.service.engine.store.trace(newest.id, "stress_event", {
      index: i,
      output: "long output ".repeat(100),
    });
  const staged = await nexus.service.engine.create({
    prompt: "Long multi-page diff",
    model: "fixture",
  });
  staged.queuedCalls = [
    {
      id: "long",
      name: "propose_edits",
      arguments: {
        edits: [
          {
            path: "long.txt",
            content: Array.from({ length: 2000 }, (_, i) => `line ${i}`).join(
              "\n",
            ),
          },
        ],
      },
    },
  ];
  await nexus.service.engine.store.save(staged);
  await nexus.service.engine.drive(staged.id);
  await page.reload();
  await expect(
    page.getByRole("button", { name: /Show more runs/ }),
  ).toBeVisible();
  await page.getByLabel("Filter run history").fill("Long multi-page diff");
  const diffStart = performance.now();
  await page.locator(".run-row").click();
  await expect(page.getByText(/Lines 1–500 of/)).toBeVisible();
  await page.evaluate(
    () =>
      new Promise((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(resolve)),
      ),
  );
  const diffFirstPageMs = performance.now() - diffStart;
  const nextPageStart = performance.now();
  await page.getByRole("button", { name: "Next diff page" }).click();
  await expect(page.getByText(/Lines 501–1000 of/)).toBeVisible();
  const diffNextPageMs = performance.now() - nextPageStart;
  await page.getByRole("button", { name: "Reject", exact: true }).click();
  await expect(page.getByText("Completed · review the result")).toBeVisible();
  await page.getByLabel("Filter run history").fill(newest.prompt);
  await page.locator(".run-row").click();
  await page.getByRole("tab", { name: "Trace", exact: true }).click();
  await expect(
    page.getByRole("button", { name: /Show more events/ }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Show more events/ }).click();
  await expect(page.locator(".trace-event")).toHaveCount(200);
  await expect(page.getByText("Trace integrity verified")).toBeVisible();
  await writeFile(
    path.join(out, "stress-runs.json"),
    JSON.stringify(
      {
        runs: 201,
        extraTraceEvents: 350,
        diffLines: 2000,
        diffFirstPageMs,
        diffNextPageMs,
        elapsedMs: performance.now() - started,
      },
      null,
      2,
    ),
  );
});
