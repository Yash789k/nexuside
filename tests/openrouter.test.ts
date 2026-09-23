import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { parseCatalog, catalogModel } from "../src/core/openrouter";
import { configSchema, defaults } from "../src/core/config";
import { complete } from "../src/core/providers";
import { Engine, approvalRevision } from "../src/core/engine";
import { Workspace } from "../src/core/workspace";
import { toolDefinitions } from "../src/core/tools";
const preset = defaults.models.find((m) => m.id === "openrouter-multimodal")!;
async function serverFor(handle: (body: any, headers: any) => unknown) {
  const server = createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify(handle(JSON.parse(body), req.headers)));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return {
    url: `http://127.0.0.1:${(server.address() as any).port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
test("OpenRouter catalog filters non-agent and dynamic-price models; converts published prices", () => {
  const base = {
    id: "vendor/coder",
    name: "Coder",
    context_length: 32000,
    architecture: {
      input_modalities: ["text", "image"],
      output_modalities: ["text"],
    },
    supported_parameters: ["tools", "reasoning"],
    pricing: { prompt: "0.000001", completion: "0.000002" },
  };
  const models = parseCatalog({
    data: [
      base,
      { ...base, id: "unsupported", supported_parameters: [] },
      { ...base, id: "dynamic", pricing: { prompt: "-1", completion: "-1" } },
    ],
  });
  assert.equal(models.length, 1);
  assert.equal(models[0].inputCost, 1);
  assert.equal(models[0].outputCost, 2);
  assert.deepEqual(models[0].capabilities, ["text", "image"]);
  assert.equal(models[0].reasoning, true);
  const m = catalogModel(models[0], 3);
  assert.equal(m.keyEnv, "OPENROUTER_API_KEY");
  assert.equal(m.id, "or-vendor-coder");
  assert.doesNotThrow(() => configSchema.parse({ ...defaults, models: [m] }));
});
test("OpenRouter sends multimodal inputs, routing, privacy, price caps and model fallbacks; records reported usage", async () => {
  let body: any, headers: any;
  const s = await serverFor((b, h) => {
    body = b;
    headers = h;
    return {
      model: "fallback/model",
      provider: "Test Provider",
      choices: [{ message: { content: "Done" } }],
      usage: { prompt_tokens: 100, completion_tokens: 50, cost: 0.0042 },
    };
  });
  try {
    const result = await complete(
      {
        ...preset,
        baseUrl: s.url,
        openrouter: {
          sort: "throughput",
          partition: "none",
          fallbackModels: ["fallback/model"],
          only: ["google"],
          ignore: ["blocked"],
          order: ["google"],
          dataCollection: "deny",
          zdr: true,
          allowFallbacks: false,
          preferredMaxLatency: 2,
          preferredMinThroughput: 30,
          reasoningEffort: "low",
        },
      },
      [
        {
          role: "user",
          content: "Review this issue",
          attachments: [
            { name: "screen.png", mime: "image/png", data: "AA==" },
            { name: "voice.mp3", mime: "audio/mpeg", data: "AA==" },
            { name: "bug.mp4", mime: "video/mp4", data: "AA==" },
          ],
        },
      ],
      toolDefinitions,
      "fixture-only",
      1000,
    );
    assert.equal(headers.authorization, "Bearer fixture-only");
    assert.equal(headers["x-openrouter-title"], "NexusIDE");
    assert.equal(body.max_tokens, 1000);
    assert.equal(body.max_completion_tokens, undefined);
    assert.equal(body.parallel_tool_calls, undefined);
    assert.equal(body.tools[0].type, "function");
    assert.deepEqual(body.models, [preset.model, "fallback/model"]);
    assert.deepEqual(body.provider.sort, {
      by: "throughput",
      partition: "none",
    });
    assert.deepEqual(body.provider.max_price, {
      prompt: 0.3,
      completion: 2.5,
      request: 0,
    });
    assert.equal(body.provider.require_parameters, true);
    assert.equal(body.provider.data_collection, "deny");
    assert.equal(body.provider.zdr, true);
    assert.equal(body.provider.allow_fallbacks, false);
    assert.equal(body.provider.preferred_max_latency, 2);
    assert.equal(body.messages[0].content[1].type, "image_url");
    assert.deepEqual(body.messages[0].content[2].input_audio, {
      data: "AA==",
      format: "mp3",
    });
    assert.equal(
      body.messages[0].content[3].video_url.url,
      "data:video/mp4;base64,AA==",
    );
    assert.equal(result.actualCost, 0.0042);
    assert.equal(result.actualModel, "fallback/model");
    assert.equal(result.actualProvider, "Test Provider");
  } finally {
    await s.close();
  }
});
test("OpenRouter agent pauses before writes, round-trips reasoning through tools, tests approved edits, and accounts reported cost", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "nexus-openrouter-"));
  const reasoning = [
    { type: "reasoning.encrypted", data: "fixture-state", format: "test-v1" },
  ];
  const received: any[] = [];
  const replies = [
    { name: "plan", arguments: { steps: ["Write an assertion", "Run it"] } },
    {
      name: "propose_edits",
      arguments: {
        edits: [
          {
            path: "test/smoke.test.mjs",
            content:
              "import test from 'node:test'; import assert from 'node:assert/strict'; test('sum', () => assert.equal(1 + 1, 2));\n",
          },
        ],
      },
    },
    { name: "run_tests", arguments: { target: "node" } },
  ];
  const s = await serverFor((b) => {
    received.push(b);
    const tool = replies[received.length - 1];
    return {
      model: preset.model,
      provider: "Fixture Provider",
      choices: [
        {
          message: tool
            ? {
                content: null,
                reasoning_details: reasoning,
                tool_calls: [
                  {
                    id: `call-${received.length}`,
                    type: "function",
                    function: {
                      name: tool.name,
                      arguments: JSON.stringify(tool.arguments),
                    },
                  },
                ],
              }
            : { content: "The test passed." },
        },
      ],
      usage: { prompt_tokens: 20, completion_tokens: 10, cost: 0.002 },
    };
  });
  try {
    const e = new Engine(
      await Workspace.open(root),
      async () => "fixture-only",
    );
    const c = {
      ...structuredClone(defaults),
      testRunner: "host" as const,
      models: [{ ...preset, baseUrl: s.url }],
    };
    const r = await e.create(
      { prompt: "Create and test a small assertion" },
      c,
    );
    const paused = await e.drive(r.id);
    assert.equal(paused.pending?.kind, "edits", paused.error);
    await assert.rejects(readFile(path.join(root, "test/smoke.test.mjs")));
    await e.decide(r.id, true, approvalRevision(await e.store.get(r.id)));
    const tests = await e.drive(r.id);
    assert.equal(tests.pending?.kind, "tests", tests.error);
    await e.decide(r.id, true, approvalRevision(await e.store.get(r.id)));
    const done = await e.drive(r.id);
    assert.equal(done.status, "completed", done.error);
    assert.equal(done.tests[0].exitCode, 0, done.tests[0].output);
    assert.equal(done.cost, 0.008);
    assert.deepEqual(
      received[1].messages.find((m: any) => m.role === "assistant")
        .reasoning_details,
      reasoning,
    );
    const events = await e.store.events(r.id);
    assert.equal(events.filter((e) => e.type === "model_call").length, 4);
    assert.ok(
      events
        .filter((e) => e.type === "model_call")
        .every(
          (e) =>
            e.data.costSource === "reported" &&
            e.data.actualProvider === "Fixture Provider",
        ),
    );
    assert.equal(await e.store.verify(r.id), true);
  } finally {
    await s.close();
    await rm(root, { recursive: true, force: true });
  }
});
