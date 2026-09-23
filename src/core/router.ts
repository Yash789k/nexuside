import type {
  Attachment,
  Config,
  KeyResolver,
  ModelConfig,
  Priority,
  RouteDecision,
  Run,
} from "./types";
export function classify(prompt: string) {
  const p = prompt.toLowerCase();
  const complex =
    /architect|refactor|authentication|migration|security|multiple|multi.file/.test(
      p,
    ) || p.length > 1000;
  return {
    taskType: /browser|website|click|dashboard.*load/.test(p)
      ? "computer_use"
      : /debug|fix|error|fail/.test(p)
        ? "debug"
        : /complete|explain|what is/.test(p)
          ? "simple_completion"
          : complex
            ? "complex_refactor"
            : "code_generation",
    complexity: complex ? "high" : p.length > 200 ? "medium" : "low",
  };
}
export async function available(config: Config, key: KeyResolver) {
  const models: ModelConfig[] = [];
  for (const model of config.models) {
    if (
      model.enabled &&
      (model.provider === "demo" || !model.keyEnv || (await key(model)))
    )
      models.push(model);
  }
  return models;
}
export async function route(
  prompt: string,
  priority: Priority,
  requested: string,
  attachments: Attachment[],
  config: Config,
  key: KeyResolver,
  history: Run[] = [],
): Promise<RouteDecision> {
  const task = classify(prompt);
  let candidates = (await available(config, key)).filter(
    (m) => m.provider !== "demo",
  );
  const modalities = [...new Set(attachments.map((a) => a.mime.split("/")[0]))];
  candidates = candidates.filter((m) =>
    modalities.every((kind) =>
      m.capabilities.includes(kind as "image" | "audio" | "video"),
    ),
  );
  if (requested !== "auto") {
    const model = (await available(config, key)).find(
      (m) => m.id === requested,
    );
    if (!model)
      throw new Error(
        "Selected model is disabled or has no configured credential",
      );
    if (modalities.some((k) => !model.capabilities.includes(k as "image")))
      throw new Error("Selected model does not support these attachments");
    candidates = [model];
  }
  if (!candidates.length)
    throw new Error(
      "Configure a provider in Settings, enable Ollama, or explicitly choose the offline demo. No capable model is available.",
    );
  const tier =
    priority === "economy"
      ? 1
      : priority === "quality"
        ? 3
        : task.complexity === "high"
          ? 3
          : task.complexity === "medium"
            ? 2
            : 1;
  const score = (m: ModelConfig) => {
    const prior = history.filter(
      (r) =>
        r.modelId === m.id &&
        r.route?.taskType === task.taskType &&
        ["completed", "failed"].includes(r.status),
    );
    const failure = prior.length
      ? prior.filter((r) => r.status === "failed").length / prior.length
      : 0;
    return (
      Math.abs(tier - m.tier) * 10 +
      (m.inputCost + m.outputCost) * 0.05 +
      failure * 3
    );
  };
  candidates.sort((a, b) => score(a) - score(b));
  const selected = candidates[0];
  return {
    modelId: selected.id,
    ...task,
    reason:
      requested !== "auto"
        ? `Manually selected ${selected.name}`
        : `${task.complexity} complexity · ${priority} preference · tier ${selected.tier}; ranked by capability, configured price and prior outcomes`,
    candidates: candidates.map((m) => m.id),
    estimatedCost:
      (Math.ceil(prompt.length / 3) * selected.inputCost +
        config.maxOutputTokens * selected.outputCost) /
      1e6,
    confidence: requested !== "auto" ? 1 : 0.75,
  };
}
