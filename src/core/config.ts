import { mkdir, readFile, writeFile, lstat } from "node:fs/promises";
import { homedir } from "node:os";
import path from "node:path";
import { z } from "zod";
import type { Config, ModelConfig } from "./types";
export const modelSchema = z.object({
  id: z.string().regex(/^[a-z0-9_-]+$/),
  name: z.string().min(1).max(100),
  provider: z.enum([
    "openai",
    "anthropic",
    "gemini",
    "openrouter",
    "ollama",
    "demo",
  ]),
  model: z.string().min(1),
  baseUrl: z.string().url(),
  keyEnv: z
    .string()
    .regex(/^[A-Z_][A-Z0-9_]*$/)
    .optional(),
  tier: z.number().int().min(1).max(3),
  inputCost: z.number().nonnegative(),
  outputCost: z.number().nonnegative(),
  capabilities: z.array(z.enum(["text", "image", "audio", "video"])),
  enabled: z.boolean(),
  openrouter: z
    .object({
      sort: z.enum(["price", "latency", "throughput"]).optional(),
      partition: z.enum(["model", "none"]).optional(),
      allowFallbacks: z.boolean().optional(),
      fallbackModels: z.array(z.string().min(1).max(200)).max(4).optional(),
      order: z.array(z.string().min(1).max(100)).max(20).optional(),
      only: z.array(z.string().min(1).max(100)).max(20).optional(),
      ignore: z.array(z.string().min(1).max(100)).max(20).optional(),
      dataCollection: z.enum(["allow", "deny"]).optional(),
      zdr: z.boolean().optional(),
      reasoningEffort: z.enum(["low", "medium", "high"]).optional(),
      preferredMinThroughput: z.number().positive().max(100000).optional(),
      preferredMaxLatency: z.number().positive().max(300).optional(),
    })
    .optional(),
});
export const configSchema = z
  .object({
    models: z.array(modelSchema).min(1).max(30),
    maxSteps: z.number().int().min(1).max(100),
    maxBudget: z.number().positive().max(100),
    maxOutputTokens: z.number().int().min(256).max(16384),
    browserDomains: z.array(
      z.string().regex(/^(localhost|[a-z0-9][a-z0-9.-]*[a-z0-9])$/),
    ),
    testRunner: z.enum(["docker", "host"]),
  })
  .superRefine((c, ctx) => {
    if (new Set(c.models.map((m) => m.id)).size !== c.models.length)
      ctx.addIssue({ code: "custom", message: "Model IDs must be unique" });
  });
// Prices are editable estimates in USD per million tokens, never billing guarantees.
export const defaults: Config = {
  models: [
    {
      id: "openai-fast",
      name: "OpenAI · Fast",
      provider: "openai",
      model: "gpt-4.1-mini",
      baseUrl: "https://api.openai.com/v1",
      keyEnv: "OPENAI_API_KEY",
      tier: 1,
      inputCost: 0.4,
      outputCost: 1.6,
      capabilities: ["text", "image"],
      enabled: true,
    },
    {
      id: "openai-quality",
      name: "OpenAI · Quality",
      provider: "openai",
      model: "gpt-4.1",
      baseUrl: "https://api.openai.com/v1",
      keyEnv: "OPENAI_API_KEY",
      tier: 3,
      inputCost: 2,
      outputCost: 8,
      capabilities: ["text", "image"],
      enabled: true,
    },
    {
      id: "claude",
      name: "Anthropic · Claude",
      provider: "anthropic",
      model: "claude-sonnet-4-6",
      baseUrl: "https://api.anthropic.com/v1",
      keyEnv: "ANTHROPIC_API_KEY",
      tier: 3,
      inputCost: 3,
      outputCost: 15,
      capabilities: ["text", "image"],
      enabled: true,
    },
    {
      id: "gemini",
      name: "Google · Gemini",
      provider: "gemini",
      model: "gemini-2.5-flash",
      baseUrl: "https://generativelanguage.googleapis.com/v1beta",
      keyEnv: "GEMINI_API_KEY",
      tier: 2,
      inputCost: 0.3,
      outputCost: 2.5,
      capabilities: ["text", "image", "audio", "video"],
      enabled: true,
    },
    {
      id: "ollama",
      name: "Ollama · Local",
      provider: "ollama",
      model: "qwen2.5-coder:7b",
      baseUrl: "http://127.0.0.1:11434/v1",
      tier: 1,
      inputCost: 0,
      outputCost: 0,
      capabilities: ["text"],
      enabled: false,
    },
    {
      id: "demo",
      name: "Offline demo",
      provider: "demo",
      model: "fibonacci-fixture",
      baseUrl: "http://localhost",
      tier: 1,
      inputCost: 0,
      outputCost: 0,
      capabilities: ["text"],
      enabled: true,
    },
    {
      id: "openrouter-coder",
      name: "OpenRouter · Coding",
      provider: "openrouter",
      model: "qwen/qwen3-coder",
      baseUrl: "https://openrouter.ai/api/v1",
      keyEnv: "OPENROUTER_API_KEY",
      tier: 1,
      inputCost: 0.3,
      outputCost: 1,
      capabilities: ["text"],
      enabled: true,
      openrouter: { sort: "price", allowFallbacks: true },
    },
    {
      id: "openrouter-quality",
      name: "OpenRouter · Quality",
      provider: "openrouter",
      model: "anthropic/claude-sonnet-4.6",
      baseUrl: "https://openrouter.ai/api/v1",
      keyEnv: "OPENROUTER_API_KEY",
      tier: 3,
      inputCost: 3,
      outputCost: 15,
      capabilities: ["text", "image"],
      enabled: true,
      openrouter: { sort: "latency", allowFallbacks: true },
    },
    {
      id: "openrouter-multimodal",
      name: "OpenRouter · Multimodal",
      provider: "openrouter",
      model: "google/gemini-2.5-flash",
      baseUrl: "https://openrouter.ai/api/v1",
      keyEnv: "OPENROUTER_API_KEY",
      tier: 2,
      inputCost: 0.3,
      outputCost: 2.5,
      capabilities: ["text", "image", "audio", "video"],
      enabled: true,
      openrouter: { sort: "price", allowFallbacks: true },
    },
  ],
  maxSteps: 24,
  maxBudget: 1,
  maxOutputTokens: 4096,
  browserDomains: [],
  testRunner: "docker",
};
export function configPath() {
  return (
    process.env.NEXUS_CONFIG ||
    path.join(homedir(), ".config", "nexuside", "config.json")
  );
}
export async function loadConfig(): Promise<Config> {
  try {
    return configSchema.parse(JSON.parse(await readFile(configPath(), "utf8")));
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === "ENOENT")
      return structuredClone(defaults);
    throw new Error(
      `Invalid configuration at ${configPath()}: ${(e as Error).message}`,
    );
  }
}
export async function saveConfig(value: unknown) {
  const config = configSchema.parse(value);
  const dest = configPath();
  await mkdir(path.dirname(dest), { recursive: true });
  try {
    if ((await lstat(dest)).isSymbolicLink())
      throw new Error("Config must not be a symlink");
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
  }
  await writeFile(dest, JSON.stringify(config, null, 2) + "\n", {
    mode: 0o600,
  });
  return config;
}
export async function envKey(model: ModelConfig) {
  return model.keyEnv ? process.env[model.keyEnv] : undefined;
}
