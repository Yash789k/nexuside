export type Mode = "ide" | "agent";
export type Priority = "economy" | "balanced" | "quality";
export type ProviderKind =
  "openai" | "anthropic" | "gemini" | "openrouter" | "ollama" | "demo";
export interface OpenRouterOptions {
  sort?: "price" | "latency" | "throughput";
  partition?: "model" | "none";
  allowFallbacks?: boolean;
  fallbackModels?: string[];
  order?: string[];
  only?: string[];
  ignore?: string[];
  dataCollection?: "allow" | "deny";
  zdr?: boolean;
  reasoningEffort?: "low" | "medium" | "high";
  preferredMinThroughput?: number;
  preferredMaxLatency?: number;
}
export interface ModelConfig {
  id: string;
  name: string;
  provider: ProviderKind;
  model: string;
  baseUrl: string;
  keyEnv?: string;
  tier: number;
  inputCost: number;
  outputCost: number;
  capabilities: ("text" | "image" | "audio" | "video")[];
  enabled: boolean;
  openrouter?: OpenRouterOptions;
}
export interface Config {
  models: ModelConfig[];
  maxSteps: number;
  maxBudget: number;
  maxOutputTokens: number;
  browserDomains: string[];
  testRunner: "docker" | "host";
}
export interface Attachment {
  name: string;
  mime: string;
  data: string;
}
export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}
export interface Message {
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  calls?: ToolCall[];
  toolId?: string;
  attachments?: Attachment[];
  reasoningDetails?: unknown[];
  reasoning?: string;
  responseModel?: string;
}
export interface ModelResponse {
  content: string;
  calls: ToolCall[];
  inputTokens: number;
  outputTokens: number;
  actualCost?: number;
  actualModel?: string;
  actualProvider?: string;
  reasoningDetails?: unknown[];
  reasoning?: string;
}
export interface ToolDefinition {
  name: string;
  description: string;
  parameters: Record<string, unknown>;
}
export interface TraceEvent {
  seq: number;
  time: string;
  type: string;
  data: Record<string, unknown>;
  previousHash: string;
  hash: string;
}
export interface Change {
  path: string;
  before: string | null;
  after: string;
  diff: string;
  applied?: boolean;
}
export interface PendingAction {
  revision?: string;
  call: ToolCall;
  kind: "edits" | "tests" | "commit" | "browser";
  title: string;
  detail: string;
  changes?: Change[];
}
export interface TestResult {
  target: string;
  exitCode: number;
  output: string;
  durationMs: number;
  runner: string;
}
export interface Run {
  id: string;
  prompt: string;
  mode: Mode;
  priority: Priority;
  requestedModel: string;
  status:
    "running" | "awaiting_approval" | "completed" | "failed" | "cancelled";
  createdAt: string;
  updatedAt: string;
  modelId?: string;
  plan: string[];
  messages: Message[];
  changes: Change[];
  tests: TestResult[];
  pending?: PendingAction;
  config: Config;
  queuedCalls: ToolCall[];
  steps: number;
  cost: number;
  inputTokens: number;
  outputTokens: number;
  modelTimeMs: number;
  error?: string;
  summary?: string;
  route?: RouteDecision;
  budget: number;
}
export interface RouteDecision {
  modelId: string;
  taskType: string;
  complexity: string;
  reason: string;
  candidates: string[];
  estimatedCost: number;
  confidence: number;
}
export interface EvalResult {
  runId: string;
  status: string;
  score: number;
  verified: boolean;
  checks: { name: string; passed: boolean | null }[];
  cost: number;
  tokens: number;
  latencyMs: number;
  blockedActions: number;
}
export type KeyResolver = (model: ModelConfig) => Promise<string | undefined>;
