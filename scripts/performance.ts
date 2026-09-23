import { mkdtemp, mkdir, writeFile, readFile, rm } from "node:fs/promises";
import { tmpdir, cpus, platform, release, arch } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";
const evidence = path.resolve("../nexuside-qa-evidence");
await mkdir(evidence, { recursive: true });
const summaries: any[] = [];
const browser = await chromium.launch();
const quantile = (v: number[], q: number) =>
  [...v].sort((a, b) => a - b)[
    Math.min(v.length - 1, Math.ceil(v.length * q) - 1)
  ];
const summary = (v: number[]) => ({
  samples: v,
  p50: quantile(v, 0.5),
  p95: quantile(v, 0.95),
});
try {
  for (const count of [10, 100, 1000, 10000]) {
    const root = await mkdtemp(path.join(tmpdir(), "nexus-perf-")),
      workspace = path.join(root, "workspace");
    await mkdir(workspace);
    await writeFile(
      path.join(workspace, "a.ts"),
      "export const benchmark = 1;\n",
    );
    for (let offset = 0; offset < count - 1; offset += 100)
      await Promise.all(
        Array.from({ length: Math.min(100, count - 1 - offset) }, (_, i) =>
          writeFile(
            path.join(workspace, `f${String(offset + i).padStart(5, "0")}.ts`),
            "// benchmark file\n" + 'const a = "content";\n'.repeat(20),
          ),
        ),
      );
    for (const variant of ["before", "after"]) {
      const repo = path.resolve(
        variant === "before"
          ? (process.env.NEXUS_BASELINE ?? "../nexuside")
          : ".",
      );
      const { Workspace } = await import(
        pathToFileURL(path.join(repo, "src/core/workspace.ts")).href
      );
      const { Service } = await import(
        pathToFileURL(path.join(repo, "src/server/service.ts")).href
      );
      const { serve } = await import(
        pathToFileURL(path.join(repo, "src/server/http.ts")).href
      );
      const { defaults } = await import(
        pathToFileURL(path.join(repo, "src/core/config.ts")).href
      );
      process.env.NEXUS_CONFIG = path.join(root, `${variant}-config.json`);
      await writeFile(process.env.NEXUS_CONFIG, JSON.stringify(defaults));
      const w = await Workspace.open(workspace),
        server = await serve(new Service(w), path.join(repo, "dist/web"), 0);
      const list: number[] = [],
        search: number[] = [],
        startup: number[] = [],
        open: number[] = [],
        openEventPaint: number[] = [],
        openNetwork: number[] = [],
        input: number[] = [],
        inputEventPaint: number[] = [];
      try {
        for (let i = 0; i < 5; i++) {
          let t = performance.now();
          await w.list();
          list.push(performance.now() - t);
          t = performance.now();
          await w.search("absent-query-zzyyxx");
          search.push(performance.now() - t);
          const context = await browser.newContext({
              viewport: { width: 1536, height: 1024 },
            }),
            page = await context.newPage();
          t = performance.now();
          await page.goto(server.url);
          await page
            .getByRole("heading", { name: "What are we building?" })
            .waitFor();
          await page.evaluate(
            () =>
              new Promise((r) =>
                requestAnimationFrame(() => requestAnimationFrame(r)),
              ),
          );
          startup.push(performance.now() - t);
          // A string keeps tsx's function-name helpers out of browser scope.
          await page.evaluate(`(() => {
            window.__openPaint = undefined;
            let pointerTime = 0;
            const inspect = () => {
              const editor = document.querySelector('[aria-label="Edit a.ts"]');
              const content = editor instanceof HTMLTextAreaElement ? editor.value : editor?.textContent;
              if (!editor?.getClientRects().length || !content?.includes("export const benchmark = 1;") || (editor instanceof HTMLTextAreaElement && editor.disabled)) {
                requestAnimationFrame(inspect);
                return;
              }
              requestAnimationFrame(() => requestAnimationFrame(() => {
                const request = performance.getEntriesByType("resource").filter((e) => e.name.endsWith("/api/file")).at(-1);
                window.__openPaint = { total: performance.now() - pointerTime, network: request?.duration };
              }));
            };
            document.addEventListener("pointerdown", () => {
              pointerTime = performance.now();
              requestAnimationFrame(inspect);
            }, { once: true, capture: true });
          })()`);
          t = performance.now();
          await page.getByRole("button", { name: "a.ts", exact: true }).click();
          const editor = page.getByRole("textbox", {
            name: "Edit a.ts",
            exact: true,
          });
          await editor.waitFor();
          await page.waitForFunction(
            () => typeof (window as any).__openPaint?.total === "number",
          );
          open.push(performance.now() - t);
          const observedOpen = await page.evaluate(
            () => (window as any).__openPaint,
          );
          if (!observedOpen)
            throw new Error("File pointer-to-paint observation missing");
          if (typeof observedOpen.network !== "number")
            throw new Error("File Resource Timing observation missing");
          openEventPaint.push(observedOpen.total);
          openNetwork.push(observedOpen.network);
          await editor.evaluate((el) => {
            (window as any).__inputPaint = undefined;
            el.addEventListener(
              "input",
              () => {
                const start = performance.now();
                requestAnimationFrame(() =>
                  requestAnimationFrame(() => {
                    (window as any).__inputPaint = performance.now() - start;
                  }),
                );
              },
              { once: true },
            );
          });
          t = performance.now();
          await editor.fill("typed benchmark value");
          await page.evaluate(
            () =>
              new Promise((r) =>
                requestAnimationFrame(() => requestAnimationFrame(r)),
              ),
          );
          input.push(performance.now() - t);
          const eventPaint = await page.evaluate(
            () => (window as any).__inputPaint,
          );
          if (typeof eventPaint !== "number")
            throw new Error("Input event-to-paint observation missing");
          inputEventPaint.push(eventPaint);
          await context.close();
        }
        summaries.push({
          count,
          variant,
          list: summary(list),
          searchNoMatch: summary(search),
          firstUsable: summary(startup),
          fileOpen: summary(open),
          filePointerToPaint: summary(openEventPaint),
          fileRequestDuration: summary(openNetwork),
          fillToPaint: summary(input),
          inputEventToPaint: summary(inputEventPaint),
        });
        console.log(
          `${variant} ${count} files: startup p95 ${quantile(startup, 0.95).toFixed(1)}ms; open ${quantile(open, 0.95).toFixed(1)}ms; search ${quantile(search, 0.95).toFixed(1)}ms`,
        );
      } finally {
        server.server.closeAllConnections();
        await new Promise<void>((r) => server.server.close(() => r()));
      }
    }
    await rm(root, { recursive: true, force: true });
  }
} finally {
  await browser.close();
  await writeFile(
    path.join(evidence, "performance.json"),
    JSON.stringify(
      {
        environment: {
          os: platform(),
          release: release(),
          arch: arch(),
          node: process.version,
          cpu: cpus()[0]?.model,
          viewport: "1536×1024",
          browser: "Playwright Chromium",
          sampleCount: 5,
          concurrentSoak: true,
        },
        method:
          "Same generated files and machine; five fresh browser contexts per tier/version. File action timing includes Playwright locator/action waiting and waits for the real file contents to be editable plus two animation frames. filePointerToPaint separately starts at browser pointerdown and ends at that same ready/paint point; fileRequestDuration uses Resource Timing. inputEventToPaint starts at the input event and ends after two animation frames. Browser events are not physical-device latency. Observed p95 of five is the sample maximum. 10,000 files is an over-limit workload.",
        summaries,
      },
      null,
      2,
    ),
  );
}
