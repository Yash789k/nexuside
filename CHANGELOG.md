# Changelog

## 0.2.0 — local QA candidate, unpublished

- Distinct IDE workspace with CodeMirror 6, persistent documents, shared split views, tab drag/reorder, group movement/resizing, quick-open, search and contextual assistance. Agent mode retains task planning, review and execution.
- Exact approval revisions prevent a delayed decision from authorizing another action. Shared file locks, compare-and-swap saves and durable recovery journals protect concurrent and interrupted writes.
- Dirty-close safeguards, editor-session recovery, file/folder operations, recovery trash, external-change comparison, UTF-8/size errors, autosave and keyboard editing.
- CLI JSON/exit-status fixes and cancellation at interactive approval prompts. Actual local VSIX/npm installation tests, POSIX PTY checks, local provider fixtures, editor/race regressions, stress/soak automation and a coverage matrix.
- Known limits include some larger-workspace file-open budget misses and unverified native Windows, physical zoom/pointer, real assistive technology and paid-provider behavior. See `docs/qa` and the accompanying evidence report.

## 0.1.0 — 2026-09-23

First functional local release: VS Code extension, browser workspace, PowerShell/macOS/Linux CLI, IDE and Agent modes, four provider families, cost-aware rule-based routing, reviewable multi-file changes, resumable approvals, Docker tests and browser automation, multimodal attachments, trace integrity and deterministic evaluations.

Includes a no-key Fibonacci walkthrough and reproducible build/test/release workflows. Provider credentials are configured by the user after installation. See the README for scope and current execution limits.

- First-class OpenRouter integration: live tool-capable model catalog, coding/quality/multimodal presets, provider preferences and fallback models, privacy controls, reasoning-state round trips, reported usage, and CLI media attachments.
