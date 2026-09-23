import { randomUUID } from "node:crypto";
import type {
  Message,
  ModelConfig,
  ModelResponse,
  ToolDefinition,
} from "./types";
import { redact } from "./store";
import { routingPreferences } from "./openrouter";
function endpoint(base: string, suffix: string) {
  const u = new URL(base);
  if (u.username || u.password || u.search || u.hash)
    throw new Error(
      "Provider URL must not contain credentials, query or fragment",
    );
  if (
    u.protocol !== "https:" &&
    !(
      u.protocol === "http:" &&
      ["localhost", "127.0.0.1", "[::1]"].includes(u.hostname)
    )
  )
    throw new Error("Remote providers require HTTPS");
  return base.replace(/\/$/, "") + suffix;
}
export class ProviderError extends Error {
  constructor(
    message: string,
    public retryable = false,
  ) {
    super(message);
  }
}
async function post(
  url: string,
  headers: Record<string, string>,
  body: unknown,
  signal?: AbortSignal,
) {
  let res: Response;
  try {
    res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      redirect: "error",
      signal: signal
        ? AbortSignal.any([signal, AbortSignal.timeout(90_000)])
        : AbortSignal.timeout(90_000),
    });
  } catch (e) {
    throw new ProviderError(
      `Provider connection failed: ${(e as Error).name}`,
      true,
    );
  }
  if (!res.ok) {
    const msg = redact((await res.text()).slice(0, 500));
    throw new ProviderError(
      `Provider returned ${res.status}: ${msg}`,
      res.status === 429 || res.status >= 500,
    );
  }
  return res.json() as Promise<any>;
}
export async function complete(
  model: ModelConfig,
  messages: Message[],
  tools: ToolDefinition[],
  key: string | undefined,
  maxTokens: number,
  signal?: AbortSignal,
): Promise<ModelResponse> {
  if (model.keyEnv && !key)
    throw new ProviderError(`Missing credential ${model.keyEnv}`);
  if (model.provider === "anthropic") {
    const system = messages
      .filter((m) => m.role === "system")
      .map((m) => m.content)
      .join("\n");
    const chat: any[] = [];
    for (const m of messages.filter((m) => m.role !== "system")) {
      const role = m.role === "assistant" ? "assistant" : "user";
      const content: any[] =
        m.role === "tool"
          ? [{ type: "tool_result", tool_use_id: m.toolId, content: m.content }]
          : [
              ...(m.content ? [{ type: "text", text: m.content }] : []),
              ...(m.attachments ?? []).map((a) => ({
                type: "image",
                source: { type: "base64", media_type: a.mime, data: a.data },
              })),
              ...(m.calls ?? []).map((c) => ({
                type: "tool_use",
                id: c.id,
                name: c.name,
                input: c.arguments,
              })),
            ];
      if (chat.at(-1)?.role === role) chat.at(-1).content.push(...content);
      else chat.push({ role, content });
    }
    const data = await post(
      endpoint(model.baseUrl, "/messages"),
      { "x-api-key": key!, "anthropic-version": "2023-06-01" },
      {
        model: model.model,
        system,
        messages: chat,
        max_tokens: maxTokens,
        ...(tools.length
          ? {
              tools: tools.map((t) => ({
                name: t.name,
                description: t.description,
                input_schema: t.parameters,
              })),
              tool_choice: { type: "auto", disable_parallel_tool_use: true },
            }
          : {}),
      },
      signal,
    );
    if (!Array.isArray(data.content))
      throw new ProviderError("Malformed Anthropic response");
    return {
      content: data.content
        .filter((p: any) => p.type === "text")
        .map((p: any) => p.text)
        .join("\n"),
      calls: data.content
        .filter((p: any) => p.type === "tool_use")
        .map((p: any) => ({ id: p.id, name: p.name, arguments: p.input })),
      inputTokens: data.usage?.input_tokens ?? 0,
      outputTokens: data.usage?.output_tokens ?? 0,
    };
  }
  if (model.provider === "gemini") {
    const names = new Map(
      messages.flatMap((m) => m.calls ?? []).map((c) => [c.id, c.name]),
    );
    const contents = messages
      .filter((m) => m.role !== "system")
      .map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts:
          m.role === "tool"
            ? [
                {
                  functionResponse: {
                    name: names.get(m.toolId!) ?? "tool",
                    response: { result: m.content },
                  },
                },
              ]
            : [
                ...(m.content ? [{ text: m.content }] : []),
                ...(m.attachments ?? []).map((a) => ({
                  inlineData: { mimeType: a.mime, data: a.data },
                })),
                ...(m.calls ?? []).map((c) => ({
                  functionCall: { name: c.name, args: c.arguments },
                })),
              ],
      }));
    const data = await post(
      endpoint(
        model.baseUrl,
        `/models/${encodeURIComponent(model.model)}:generateContent`,
      ),
      { "x-goog-api-key": key! },
      {
        systemInstruction: {
          parts: [
            {
              text: messages
                .filter((m) => m.role === "system")
                .map((m) => m.content)
                .join("\n"),
            },
          ],
        },
        contents,
        generationConfig: { maxOutputTokens: maxTokens },
        ...(tools.length
          ? {
              tools: [
                {
                  functionDeclarations: tools.map((t) => ({
                    name: t.name,
                    description: t.description,
                    parameters: t.parameters,
                  })),
                },
              ],
            }
          : {}),
      },
      signal,
    );
    const parts = data.candidates?.[0]?.content?.parts;
    if (!parts)
      throw new ProviderError(
        "Gemini returned no candidate (possibly safety-filtered)",
      );
    return {
      content: parts
        .filter((p: any) => p.text && !p.thought)
        .map((p: any) => p.text)
        .join("\n"),
      calls: parts
        .filter((p: any) => p.functionCall)
        .map((p: any) => ({
          id: randomUUID(),
          name: p.functionCall.name,
          arguments: p.functionCall.args ?? {},
        })),
      inputTokens: data.usageMetadata?.promptTokenCount ?? 0,
      outputTokens: data.usageMetadata?.candidatesTokenCount ?? 0,
    };
  }
  const isOpenRouter = model.provider === "openrouter";
  const chat = messages.map((m) => ({
    role: m.role,
    content: m.attachments?.length
      ? [
          { type: "text", text: m.content },
          ...m.attachments.map((a) => {
            if (isOpenRouter && a.mime.startsWith("audio/"))
              return {
                type: "input_audio",
                input_audio: {
                  data: a.data,
                  format:
                    (
                      { "audio/mpeg": "mp3", "audio/mp4": "m4a" } as Record<
                        string,
                        string
                      >
                    )[a.mime] ?? a.mime.split("/")[1],
                },
              };
            if (isOpenRouter && a.mime.startsWith("video/"))
              return {
                type: "video_url",
                video_url: { url: `data:${a.mime};base64,${a.data}` },
              };
            return {
              type: "image_url",
              image_url: { url: `data:${a.mime};base64,${a.data}` },
            };
          }),
        ]
      : m.content || null,
    ...(m.toolId ? { tool_call_id: m.toolId } : {}),
    ...(isOpenRouter && m.responseModel === model.model && m.reasoningDetails
      ? { reasoning_details: m.reasoningDetails }
      : {}),
    ...(isOpenRouter &&
    m.responseModel === model.model &&
    m.reasoning &&
    !m.reasoningDetails
      ? { reasoning: m.reasoning }
      : {}),
    ...(m.calls?.length
      ? {
          tool_calls: m.calls.map((c) => ({
            id: c.id,
            type: "function",
            function: { name: c.name, arguments: JSON.stringify(c.arguments) },
          })),
        }
      : {}),
  }));
  const data = await post(
    endpoint(model.baseUrl, "/chat/completions"),
    {
      ...(key ? { Authorization: `Bearer ${key}` } : {}),
      ...(isOpenRouter
        ? {
            "HTTP-Referer": "https://github.com/Yash789k/nexuside",
            "X-OpenRouter-Title": "NexusIDE",
          }
        : {}),
    },
    {
      model: model.model,
      messages: chat,
      ...(isOpenRouter
        ? {
            max_tokens: maxTokens,
            provider: routingPreferences(model),
            ...(model.openrouter?.fallbackModels?.length
              ? {
                  models: [model.model, ...model.openrouter.fallbackModels],
                  route: "fallback",
                }
              : {}),
            ...(model.openrouter?.reasoningEffort
              ? { reasoning: { effort: model.openrouter.reasoningEffort } }
              : {}),
          }
        : { max_completion_tokens: maxTokens }),
      ...(tools.length
        ? {
            tools: tools.map((t) => ({ type: "function", function: t })),
            ...(!isOpenRouter ? { parallel_tool_calls: false } : {}),
          }
        : {}),
    },
    signal,
  );
  const message = data.choices?.[0]?.message;
  if (data.error)
    throw new ProviderError(
      `Provider error: ${redact(String(data.error.message ?? "Unknown error"))}`,
      Number(data.error.code) === 429 || Number(data.error.code) >= 500,
    );
  if (!message) throw new ProviderError("Provider returned no completion");
  if (message.refusal)
    throw new ProviderError(`Model refused: ${message.refusal}`);
  return {
    content: message.content ?? "",
    calls: (message.tool_calls ?? []).map((c: any) => ({
      id: c.id,
      name: c.function.name,
      arguments: JSON.parse(c.function.arguments),
    })),
    inputTokens: data.usage?.prompt_tokens ?? 0,
    outputTokens: data.usage?.completion_tokens ?? 0,
    ...(isOpenRouter
      ? {
          actualCost:
            typeof data.usage?.cost === "number" &&
            Number.isFinite(data.usage.cost) &&
            data.usage.cost >= 0
              ? data.usage.cost
              : undefined,
          actualModel:
            typeof data.model === "string" ? data.model : model.model,
          actualProvider:
            typeof data.provider === "string" ? data.provider : undefined,
          reasoningDetails: Array.isArray(message.reasoning_details)
            ? message.reasoning_details
            : undefined,
          reasoning:
            typeof message.reasoning === "string"
              ? message.reasoning
              : undefined,
        }
      : {}),
  };
}
