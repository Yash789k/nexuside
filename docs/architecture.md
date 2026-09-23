# Architecture

```
VS Code Webview ── postMessage ─┐
Browser React UI ─ loopback API ├─ Service ─ Engine ─ Router ─ Provider adapters
CLI / PowerShell ──────────────┘              │
                                   Workspace + Policy
                                     │          │
                                Staged edits   Approvals
                                     │          │
                                   Test / Git / Docker Browser
                                            │
                                     Store + Evaluation
```

`src/core` owns runtime behavior. Native tool-call structures are translated into one internal format; the model proposes actions, while the engine validates arguments and gates mutation. A pending call, conversation, configuration snapshot, proposed preimages, and remaining tool calls are persisted so the process may pause between approvals. Temporary provider failures can fall back within the eligible set; authentication failures do not silently switch billing providers. The offline demo is opt-in and cannot be a cloud fallback.

`src/server/service.ts` is the shared application API. The loopback transport binds only 127.0.0.1, rejects unexpected Host/Origin, and requires a random bearer token. The browser bootstraps the token from a URL fragment, removes it from the URL, and keeps it in session storage. The extension uses constrained webview resources and a nonce-based CSP; filesystem actions remain in the trusted extension host.

`src/core/workspace.ts` validates portable relative paths, sensitive names and link boundaries, caps file sizes, stages complete-file diffs, and verifies all preimages before applying a batch. Each file is atomically replaced; if an ordinary later write fails, earlier files are rolled back. This is not a crash-atomic filesystem transaction. A workspace lock serializes engine execution; direct user edits are detected by preimage conflicts.

`src/core/sandbox.ts` manages disposable Docker resources. Browser and proxy share an internal network; the proxy alone joins an outbound network. No host credential files are mounted. Browser action results include DOM text and screenshot references. Test snapshots are separate temporary directories, cleaned after execution. Test commands are fixed argument vectors, never interpolated shell strings.

`src/core/store.ts` persists local JSON runs and hash-chained JSONL events. The evaluation module reports completion, trace integrity, presence of a plan, test outcome, budget compliance, and approval compliance. Costs use OpenRouter-reported usage cost when available; otherwise they use returned token counts multiplied by user-editable rate estimates. These are engineering checks, not benchmark results or billing guarantees.

## Protocol references

Adapters follow the official [OpenAI Chat Completions API](https://developers.openai.com/api/reference/resources/chat/subresources/completions/methods/create), [Anthropic Messages API](https://platform.claude.com/docs/en/api/messages/create), [Gemini generateContent API](https://ai.google.dev/api/generate-content), [OpenRouter tool calling](https://openrouter.ai/docs/guides/features/tool-calling), and [Ollama compatibility API](https://docs.ollama.com/api/openai-compatibility). Extension packaging and webview behavior follow the official [VS Code extension publishing](https://code.visualstudio.com/api/working-with-extensions/publishing-extension) and [webview](https://code.visualstudio.com/api/extension-guides/webview) guides.
