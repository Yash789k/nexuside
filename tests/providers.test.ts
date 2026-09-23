import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { complete, ProviderError } from "../src/core/providers";
import { defaults } from "../src/core/config";
import { toolDefinitions } from "../src/core/tools";
async function mock(response: unknown, status = 200) {
  let request: any;
  let headers: any;
  const server = createServer(async (req, res) => {
    let b = "";
    for await (const c of req) b += c;
    request = JSON.parse(b);
    headers = req.headers;
    res.writeHead(status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(response));
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  return {
    url: `http://127.0.0.1:${(server.address() as any).port}`,
    request: () => request,
    headers: () => headers,
    close: () => new Promise<void>((r) => server.close(() => r())),
  };
}
test("OpenAI-compatible adapter serializes native tools, image context and usage", async () => {
  const s = await mock({
    choices: [
      {
        message: {
          content: null,
          tool_calls: [
            {
              id: "c1",
              function: { name: "read_file", arguments: '{"path":"a.ts"}' },
            },
          ],
        },
      },
    ],
    usage: { prompt_tokens: 10, completion_tokens: 4 },
  });
  try {
    const model = { ...defaults.models[0], baseUrl: s.url };
    const r = await complete(
      model,
      [
        {
          role: "user",
          content: "Inspect",
          attachments: [{ name: "a.png", mime: "image/png", data: "AA==" }],
        },
      ],
      toolDefinitions,
      "fixture-only",
      1000,
    );
    assert.equal(r.calls[0].name, "read_file");
    assert.equal(r.inputTokens, 10);
    assert.equal(
      s.request().messages[0].content[1].image_url.url,
      "data:image/png;base64,AA==",
    );
    assert.equal(s.request().tools[0].type, "function");
    assert.equal(s.headers().authorization, "Bearer fixture-only");
  } finally {
    await s.close();
  }
});
test("Anthropic adapter supports tool results and token accounting", async () => {
  const s = await mock({
    content: [{ type: "tool_use", id: "c2", name: "list_files", input: {} }],
    usage: { input_tokens: 12, output_tokens: 5 },
  });
  try {
    const r = await complete(
      { ...defaults.models[2], baseUrl: s.url },
      [
        { role: "system", content: "system" },
        { role: "user", content: "hi" },
        {
          role: "assistant",
          content: "",
          calls: [{ id: "c1", name: "read_file", arguments: { path: "x" } }],
        },
        { role: "tool", toolId: "c1", content: "hello" },
      ],
      toolDefinitions,
      "fixture-only",
      1000,
    );
    assert.equal(r.calls[0].name, "list_files");
    assert.equal(s.request().messages.at(-1).content[0].type, "tool_result");
    assert.equal(s.headers()["anthropic-version"], "2023-06-01");
  } finally {
    await s.close();
  }
});
test("Gemini adapter passes video and audio through native inlineData and maps function calls", async () => {
  const s = await mock({
    candidates: [
      {
        content: {
          parts: [
            { text: "Result" },
            { functionCall: { name: "plan", args: { steps: ["Inspect"] } } },
          ],
        },
      },
    ],
    usageMetadata: { promptTokenCount: 7, candidatesTokenCount: 3 },
  });
  try {
    const r = await complete(
      { ...defaults.models[3], baseUrl: s.url },
      [
        { role: "system", content: "test" },
        {
          role: "user",
          content: "Describe",
          attachments: [{ name: "a.mp4", mime: "video/mp4", data: "AA==" }],
        },
      ],
      toolDefinitions,
      "fixture-only",
      1000,
    );
    assert.equal(r.content, "Result");
    assert.equal(r.calls[0].name, "plan");
    assert.equal(
      s.request().contents[0].parts[1].inlineData.mimeType,
      "video/mp4",
    );
    assert.equal(s.headers()["x-goog-api-key"], "fixture-only");
  } finally {
    await s.close();
  }
});
test("temporary provider errors are eligible for fallback; authentication errors are not", async () => {
  for (const [status, retry] of [
    [429, true],
    [503, true],
    [401, false],
  ] as const) {
    const s = await mock({ error: "failure" }, status);
    try {
      await assert.rejects(
        complete(
          { ...defaults.models[0], baseUrl: s.url },
          [{ role: "user", content: "hello" }],
          [],
          "fixture-only",
          1000,
        ),
        (e: any) => e instanceof ProviderError && e.retryable === retry,
      );
    } finally {
      await s.close();
    }
  }
});
test("provider endpoints reject remote plaintext and URL credentials", async () => {
  for (const baseUrl of [
    "http://example.com/v1",
    "https://secret@example.com/v1",
  ])
    await assert.rejects(
      complete(
        { ...defaults.models[0], baseUrl },
        [{ role: "user", content: "x" }],
        [],
        "fixture-only",
        1000,
      ),
      /HTTPS|credentials/,
    );
});
