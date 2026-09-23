import type { ModelConfig, OpenRouterOptions } from "./types";

export interface CatalogModel {
  id: string;
  name: string;
  contextLength: number;
  inputCost: number;
  outputCost: number;
  capabilities: ModelConfig["capabilities"];
  reasoning: boolean;
}

// Catalog pricing is per token; NexusIDE displays USD per million tokens.
export function parseCatalog(value: unknown): CatalogModel[] {
  const data = (value as { data?: unknown[] })?.data;
  if (!Array.isArray(data)) throw new Error("Invalid OpenRouter model catalog");
  return data
    .flatMap((raw: any) => {
      const inputCost = Number(raw.pricing?.prompt) * 1e6;
      const outputCost = Number(raw.pricing?.completion) * 1e6;
      if (
        typeof raw.id !== "string" ||
        typeof raw.name !== "string" ||
        !raw.supported_parameters?.includes("tools") ||
        !raw.architecture?.output_modalities?.includes("text") ||
        !Number.isFinite(inputCost) ||
        !Number.isFinite(outputCost) ||
        inputCost < 0 ||
        outputCost < 0
      )
        return [];
      return [
        {
          id: raw.id,
          name: raw.name,
          contextLength: Number(raw.context_length) || 0,
          inputCost,
          outputCost,
          capabilities: (["text", "image", "audio", "video"] as const).filter(
            (m) => raw.architecture?.input_modalities?.includes(m),
          ),
          reasoning: raw.supported_parameters.includes("reasoning"),
        },
      ];
    })
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function catalogModel(model: CatalogModel, tier = 2): ModelConfig {
  return {
    id: "or-" + model.id.toLowerCase().replace(/[^a-z0-9_-]/g, "-"),
    name: "OpenRouter · " + model.name.slice(0, 80),
    provider: "openrouter",
    model: model.id,
    baseUrl: "https://openrouter.ai/api/v1",
    keyEnv: "OPENROUTER_API_KEY",
    tier,
    inputCost: model.inputCost,
    outputCost: model.outputCost,
    capabilities: model.capabilities,
    enabled: true,
    openrouter: { sort: "price", allowFallbacks: true },
  };
}

export function routingPreferences(model: ModelConfig) {
  const o: OpenRouterOptions = model.openrouter ?? {};
  return {
    sort: { by: o.sort ?? "price", partition: o.partition ?? "model" },
    allow_fallbacks: o.allowFallbacks ?? true,
    require_parameters: true,
    // Apply the same token-price ceilings to every endpoint and fallback model.
    max_price: {
      prompt: model.inputCost,
      completion: model.outputCost,
      request: 0,
    },
    ...(o.order?.length ? { order: o.order } : {}),
    ...(o.only?.length ? { only: o.only } : {}),
    ...(o.ignore?.length ? { ignore: o.ignore } : {}),
    ...(o.dataCollection ? { data_collection: o.dataCollection } : {}),
    ...(o.zdr ? { zdr: true } : {}),
    ...(o.preferredMinThroughput
      ? { preferred_min_throughput: o.preferredMinThroughput }
      : {}),
    ...(o.preferredMaxLatency
      ? { preferred_max_latency: o.preferredMaxLatency }
      : {}),
  };
}
