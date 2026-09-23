import { test, expect } from "./fixtures";
import { mkdir, writeFile, readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { monitorEventLoopDelay } from "node:perf_hooks";
const seconds = Number(process.env.NEXUS_SOAK_SECONDS ?? 0);
test("S01 bounded local browser soak with seeded edits, mode/group cycles and real saves", async ({
  page,
  nexus,
}, info) => {
  test.skip(
    !seconds,
    "Run npm run test:soak for the bounded 30-minute workload",
  );
  test.setTimeout((seconds + 90) * 1000);
  const label = process.env.NEXUS_SOAK_LABEL ?? "soak";
  const evidence = path.resolve(process.env.NEXUS_EVIDENCE ?? "../nexuside-qa-evidence");
  await mkdir(evidence, { recursive: true });
  const sourceHasher = createHash("sha256");
  async function hashSources(dir: string) {
    for (const item of (await readdir(dir, { withFileTypes: true })).sort(
      (a, b) => a.name.localeCompare(b.name),
    )) {
      const file = path.join(dir, item.name);
      if (item.isDirectory()) await hashSources(file);
      else sourceHasher.update(file).update(await readFile(file));
    }
  }
  await hashSources("src");
  const sourceHash = sourceHasher.digest("hex");
  const seed = Number(process.env.NEXUS_SEED ?? 230923);
  let rng = seed;
  const random = () =>
    (rng = (Math.imul(rng, 1664525) + 1013904223) >>> 0) / 4294967296;
  const errors: string[] = [],
    actions: any[] = [],
    samples: any[] = [],
    requests: Record<string, number> = {},
    overlap: Record<string, number> = {},
    flight: Record<string, number> = {};
  page.on("pageerror", (e) => errors.push(e.stack ?? e.message));
  page.on("request", (r) => {
    if (r.url().includes("/api/")) {
      const k = r.url().split("/").at(-1)!;
      requests[k] = (requests[k] ?? 0) + 1;
      flight[k] = (flight[k] ?? 0) + 1;
      overlap[k] = Math.max(overlap[k] ?? 0, flight[k]);
    }
  });
  const done = (r: any) => {
    if (r.url().includes("/api/")) {
      const k = r.url().split("/").at(-1)!;
      flight[k] = Math.max(0, (flight[k] ?? 1) - 1);
    }
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
  const cdp = await page.context().newCDPSession(page);
  await cdp.send("Performance.enable");
  await page.evaluate(() => {
    (window as any).__longTasks = [];
    new PerformanceObserver((list) =>
      (window as any).__longTasks.push(
        ...list
          .getEntries()
          .map((e) => ({ duration: e.duration, startTime: e.startTime })),
      ),
    ).observe({ entryTypes: ["longtask"] });
  });
  const delay = monitorEventLoopDelay({ resolution: 20 });
  delay.enable();
  const cpu = process.cpuUsage();
  const buildHash = createHash("sha256")
    .update(await readFile("dist/web/app.js"))
    .digest("hex");
  await page.getByRole("button", { name: "IDE", exact: true }).click();
  await expect(page.getByText("Recovery ready", { exact: true })).toBeVisible();
  for (const name of ["a.ts", "b.ts", "README.md"])
    await page.getByRole("button", { name: `◇ ${name}`, exact: true }).click();
  const start = performance.now();
  let step = 0,
    lastSample = 0;
  try {
    while (performance.now() - start < seconds * 1000) {
      const name = ["a.ts", "b.ts"][Math.floor(random() * 2)];
      await page
        .getByRole("button", { name: `◇ ${name}`, exact: true })
        .click();
      const text = `// soak seed ${seed} step ${step}\nexport const value = ${step}; // 😀\n`;
      const editor = page.getByRole("textbox", { name: `Edit ${name}` }).last();
      const at = performance.now();
      await editor.fill(text);
      await page.evaluate(
        () =>
          new Promise((r) =>
            requestAnimationFrame(() => requestAnimationFrame(r)),
          ),
      );
      const inputPaintMs = performance.now() - at;
      await page.getByRole("button", { name: "Save All", exact: true }).click();
      await expect
        .poll(() => readFile(path.join(nexus.workspace, name), "utf8"))
        .toBe(text);
      if (step % 5 === 0) {
        await page.getByRole("button", { name: "Agent", exact: true }).click();
        await page
          .getByLabel("Task prompt")
          .fill(`preserved task draft ${step}`);
        await page.getByRole("button", { name: "IDE", exact: true }).click();
      }
      if (step % 7 === 0) {
        await page
          .getByRole("button", { name: "Split Right", exact: true })
          .click();
        const sep = page.getByRole("separator").first();
        await sep.focus();
        await sep.press("ArrowLeft");
        await page
          .getByRole("button", { name: "Commands", exact: true })
          .click();
        await page
          .getByRole("button", { name: "Close Group (move tabs)", exact: true })
          .click();
      }
      if (step % 11 === 0) {
        await page
          .getByRole("button", { name: `Close ${name}`, exact: true })
          .last()
          .click();
        await page
          .getByRole("button", { name: `◇ ${name}`, exact: true })
          .click();
      }
      if (step % 17 === 0) {
        await page.getByRole("button", { name: "Agent", exact: true }).click();
        await page.getByLabel("Model", { exact: true }).selectOption("fixture");
        await page.getByLabel("Task prompt").fill(`Local soak query ${step}`);
        await page
          .getByRole("button", { name: "Send task", exact: true })
          .click();
        await expect(
          page.getByText("Completed · review the result"),
        ).toBeVisible();
        await page.getByRole("button", { name: "IDE", exact: true }).click();
      }
      actions.push({
        step,
        name,
        inputPaintMs,
        elapsedMs: performance.now() - start,
      });
      if (performance.now() - start - lastSample > 60_000 || step === 0) {
        await cdp.send("HeapProfiler.collectGarbage");
        const metrics = await cdp.send("Performance.getMetrics");
        samples.push({
          elapsedMs: performance.now() - start,
          metrics: Object.fromEntries(
            metrics.metrics.map((m) => [m.name, m.value]),
          ),
          nodeRss: process.memoryUsage().rss,
        });
        lastSample = performance.now() - start;
        await writeFile(
          path.join(evidence, `${label}-progress.json`),
          JSON.stringify(
            {
              seed,
              buildHash,
              sourceHash,
              seconds,
              step,
              elapsedMs: lastSample,
              samples,
              errors,
            },
            null,
            2,
          ),
        );
        console.log(
          `Soak ${Math.round(lastSample / 1000)}s / ${seconds}s; ${step + 1} cycles; ${errors.length} browser errors`,
        );
      }
      expect(errors).toEqual([]);
      step++;
      await page.waitForTimeout(2500);
    }
    await cdp.send("HeapProfiler.collectGarbage");
    const metrics = await cdp.send("Performance.getMetrics");
    samples.push({
      elapsedMs: performance.now() - start,
      metrics: Object.fromEntries(
        metrics.metrics.map((m) => [m.name, m.value]),
      ),
      nodeRss: process.memoryUsage().rss,
    });
    expect(overlap.state ?? 0).toBeLessThanOrEqual(1);
    expect(overlap.run ?? 0).toBeLessThanOrEqual(1);
    await page.screenshot({ path: path.join(evidence, `${label}-final.png`) });
  } finally {
    delay.disable();
    const report = {
      seed,
      buildHash,
      sourceHash,
      requestedSeconds: seconds,
      elapsedMs: performance.now() - start,
      cycles: step,
      actions,
      samples,
      requests,
      maxConcurrentRequests: overlap,
      errors,
      cpu: process.cpuUsage(cpu),
      eventLoopDelayMs: {
        mean: delay.mean / 1e6,
        max: delay.max / 1e6,
        p95: delay.percentile(95) / 1e6,
      },
      longTasks: await page
        .evaluate(() => (window as any).__longTasks)
        .catch(() => []),
    };
    await writeFile(
      path.join(evidence, `${label}.json`),
      JSON.stringify(report, null, 2),
    );
    await info.attach("soak report", {
      body: JSON.stringify(report),
      contentType: "application/json",
    });
  }
});
