# OpenRouter in NexusIDE

The same adapter and approval engine power the CLI, VS Code extension, and local dashboard. One OpenRouter key can access the configured model families. Your OpenRouter account's model availability, credits, and provider restrictions still apply.

## Start

In VS Code, run **NexusIDE: Configure Provider Key** and select `OPENROUTER_API_KEY`, or use Settings. VS Code saves it in SecretStorage. The standalone dashboard retains keys only for its server session. The CLI reads `OPENROUTER_API_KEY` from its environment; it does not inherit keys saved in VS Code.

Choose an OpenRouter preset in the composer. Auto routing considers all enabled, configured models; enable only the providers you want it to use.

| Use case | Configuration |
|---|---|
| Everyday coding and code explanation | `openrouter-coder`: Qwen3 Coder, tier 1, price sorting |
| Larger refactors and image-guided changes | `openrouter-quality`: Claude Sonnet 4.6, tier 3, latency sorting |
| Diagnose a screenshot, recorded bug, or spoken requirement | `openrouter-multimodal`: Gemini 2.5 Flash; image/audio/video attachments |
| Prefer fast responses | Set Optimize for to lowest latency; optionally set a preferred maximum latency |
| Prefer faster generation | Highest throughput; optionally set a preferred minimum tokens/second |
| Choose among several acceptable models | Add up to four fallback IDs and select Compare all fallback models |
| Continue when an endpoint is unavailable | Enable provider fallbacks; optionally configure alternative models |
| Restrict providers and retention | Provider allowlist/exclusions, Deny data collection, Require zero data retention |
| Use additional models | Load the catalog, filter by model or modality, Add, then Save settings |
| Reasoning with tools | Choose a reasoning-capable model and effort; NexusIDE round-trips returned reasoning state |

## CLI

```sh
nexus models
nexus openrouter catalog --search qwen
nexus openrouter catalog --modality video --json
nexus -w ./project run "Refactor this module and add tests" --model openrouter-quality
nexus -w ./project run "Diagnose the attached screen recording" --model openrouter-multimodal --attach bug.mp4
nexus -w ./project run "Implement the spoken requirement" --model openrouter-multimodal --attach requirement.mp3
```

`--attach` is repeatable. Files must be relative to the workspace, with up to five files and 20 MB total. Images: PNG/JPEG/WebP/GIF; audio: WAV/MP3/M4A; video: MP4/WebM. Model/provider-specific support still applies. The dashboard has the same attachment workflow. PowerShell supports the same commands; use `nexus.cmd` if script-shim execution is blocked.

Use `nexus openrouter add <catalog-model-id> --tier 2 --sort price` to import a new model. Duplicate models are rejected; change existing entries in Settings or the keyless config returned by `nexus config --path`.

## Routing preferences

For advanced CLI setup, the optional `openrouter` field on a model in the JSON config accepts:

```json
{
  "sort": "throughput",
  "partition": "none",
  "allowFallbacks": true,
  "fallbackModels": ["google/gemini-2.5-flash"],
  "order": [],
  "only": [],
  "ignore": [],
  "dataCollection": "deny",
  "zdr": true,
  "preferredMaxLatency": 3,
  "preferredMinThroughput": 30
}
```

Use provider slugs from OpenRouter for `order`, `only`, and `ignore`; use complete model IDs for `fallbackModels`. Fallback models must support tools and any attached modalities. Optional `reasoningEffort` is `low`, `medium`, or `high` and requires model support. `partition: model` tries the primary model first; `none` sorts endpoints across all listed models. Provider fallback and alternate-model fallback are separate controls.

NexusIDE requires parameter support and sets `max_price.prompt`/`completion` from the model's configured USD-per-million-token prices, with per-request fees capped at zero. The same ceilings apply to alternate models. Performance targets are preferences, while price, provider, and privacy restrictions can cause a request to fail if no eligible endpoint remains. Restrictions on one OpenRouter model do not automatically apply to other models in NexusIDE's Auto routing list; disable unwanted alternatives or manually select the configured model when enforcing a specific policy.

The public catalog is fetched on demand and cached for five minutes. It excludes models without tool support or known token prices, including dynamically priced router aliases. Catalog prices are reference rates; providers may charge more for long contexts or modalities. Budget checks are estimates, not billing guarantees. OpenRouter's reported `usage.cost` takes precedence in run accounting; the trace identifies reported versus estimated cost and records the returned model/provider. Set account-level spending limits in OpenRouter for an external billing limit.

Returned reasoning state is stored in the local run and sent back only for the same model. It is omitted from dashboard API responses and trace events. Other run data may include private project context. Protect `.nexus/` like your source files.

## Validation and scope

Local HTTP fixtures test multimodal encoding, native tool calls, privacy and fallback preferences, token price ceilings, reported cost, model/provider attribution, and an entire plan → proposed edit → approval → test → approval → completion cycle. Browser tests cover importing a model and saving routing preferences. The public catalog was checked live; paid inference remains untested until you configure your key.

This release supports text-producing agent workflows with media input. It does not generate audio/video, implement OpenRouter OAuth/BYOK account management, or offer continuous voice/video capture. Those are separate product features.

The implementation follows the official [tool calling](https://openrouter.ai/docs/guides/features/tool-calling), [provider routing](https://openrouter.ai/docs/guides/routing/provider-selection), [audio](https://openrouter.ai/docs/guides/overview/multimodal/audio), [video](https://openrouter.ai/docs/guides/overview/multimodal/videos), and [reasoning](https://openrouter.ai/docs/guides/best-practices/reasoning-tokens) contracts.
