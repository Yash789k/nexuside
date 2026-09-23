import { test as base, expect } from "@playwright/test";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { Workspace } from "../../src/core/workspace";
import { Service } from "../../src/server/service";
import { serve } from "../../src/server/http";
import { defaults } from "../../src/core/config";
export const test = base.extend<{
  nexus: {
    workspace: string;
    url: string;
    service: Service;
    request: (action: string, data?: unknown) => Promise<any>;
  };
}>({
  nexus: [
    async ({ page }, use) => {
      const root = await mkdtemp(path.join(tmpdir(), "nexus-ui-")),
        workspace = path.join(root, "workspace");
      await mkdir(workspace);
      for (const [file, content] of Object.entries({
        "README.md": "# Fibonacci workspace\n",
        "a.ts": "export const alpha = 1;\n",
        "b.ts": "export const beta = 2;\n",
        "unicode 空間.txt": "Hello 😀 é\r\nSecond line\r\n",
      }))
        await writeFile(path.join(workspace, file), content);
      const provider = createServer(async (req, res) => {
        res.setHeader("Content-Type", "application/json");
        if (req.url === "/models") {
          res.end(
            JSON.stringify({
              data: [
                {
                  id: "test/catalog-coder",
                  name: "Catalog Coder",
                  context_length: 128000,
                  pricing: { prompt: "0.00000025", completion: "0.0000005" },
                  architecture: {
                    input_modalities: ["text", "image"],
                    output_modalities: ["text"],
                  },
                  supported_parameters: ["tools", "reasoning"],
                },
              ],
            }),
          );
          return;
        }
        let raw = "";
        for await (const c of req) raw += c;
        const body = JSON.parse(raw || "{}");
        const text = body.messages?.at(-1)?.content ?? "";
        if (String(text).includes("SLOW_FIXTURE"))
          await new Promise((r) => setTimeout(r, 1500));
        if (String(text).includes("FAIL_FIXTURE")) {
          res.statusCode = 401;
          res.end(
            JSON.stringify({
              error: { message: "Fixture invalid credential" },
            }),
          );
          return;
        }
        res.end(
          JSON.stringify({
            choices: [
              {
                message: {
                  content:
                    "Local provider received context. Focused assistance completed.",
                },
              },
            ],
            usage: { prompt_tokens: 20, completion_tokens: 10 },
          }),
        );
      });
      await new Promise<void>((r) => provider.listen(0, "127.0.0.1", r));
      const providerURL = `http://127.0.0.1:${(provider.address() as any).port}`;
      const originalFetch = globalThis.fetch;
      globalThis.fetch = ((input: any, init: any) =>
        originalFetch(
          String(input) === "https://openrouter.ai/api/v1/models"
            ? `${providerURL}/models`
            : input,
          init,
        )) as typeof fetch;
      const oldConfig = process.env.NEXUS_CONFIG;
      process.env.NEXUS_CONFIG = path.join(root, "config.json");
      await writeFile(
        process.env.NEXUS_CONFIG,
        JSON.stringify({
          ...defaults,
          testRunner: "host",
          models: [
            {
              ...defaults.models[0],
              id: "fixture",
              name: "Local provider fixture",
              keyEnv: undefined,
              baseUrl: providerURL,
            },
            ...defaults.models.map((m) =>
              m.provider === "demo" ? m : { ...m, enabled: false },
            ),
          ],
        }),
      );
      const service = new Service(await Workspace.open(workspace)),
        server = await serve(service, path.resolve("dist/web"), 0);
      const request = (action: string, data: unknown = {}) =>
        service.request(action, data);
      try {
        await page.goto(server.url);
        await expect(
          page.getByRole("heading", { name: "What are we building?" }),
        ).toBeVisible();
        await use({ workspace, url: server.url, service, request });
      } finally {
        await page.close();
        server.server.closeAllConnections();
        provider.closeAllConnections();
        await Promise.all([
          new Promise<void>((r) => server.server.close(() => r())),
          new Promise<void>((r) => provider.close(() => r())),
        ]);
        globalThis.fetch = originalFetch;
        if (oldConfig) process.env.NEXUS_CONFIG = oldConfig;
        else delete process.env.NEXUS_CONFIG;
        await rm(root, { recursive: true, force: true });
      }
    },
    { auto: true },
  ],
});
export { expect };
