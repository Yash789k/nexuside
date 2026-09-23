# Verification contract

Baseline: 2cd8818b057b26c59f3ec95b5763d42783b2cb64; original checkout clean. Changes are isolated on codex/nexuside-qa. Published release and the existing :4317 session are excluded from mutation. Browser plugin unavailable; use Playwright Chromium. No provider load testing or paid inference.

## Budgets declared before optimization

On this macOS arm64 / Node 22 environment, target p95: first usable view < 2 s, small file open < 300 ms, tab switch < 100 ms, editor input-to-next-paint < 100 ms, indexed file search < 500 ms for supported 1,000-file workspaces. Keep at most one state and one selected-run poll in flight per client. Poll active runs only; idle state refresh 5 s. Target no monotonic retained-memory growth > 20 MB after warmup in a 30-minute small-workspace soak. These are targets, not measurements or universal guarantees.

## Supported bounds

Text files ≤512,000 bytes; at most 100 open documents and 4 editor groups; file inventory ≤1,200 entries / 12 levels, disclosed when truncated; bounded content-search results; media ≤5 files / 20 MB total. Workspaces with 10,000 files and over-size inputs are over-limit tests. Native shell execution policy remains unchanged. Syntax highlighting/indentation/search are owned by the browser editor; language-server diagnostics, full symbol intelligence, debugging and unrestricted terminals remain native VS Code or separate product capabilities.

## Critical acceptance journeys

Q01 exact proposal/revision approval across delayed and concurrent clients; Q02 conflict-safe idempotent saves and newer typing during saves; Q03 dirty document survival across tabs, views, modes, reload and recovery; Q04 multiple tabs, independent selection/scroll/undo, splits, moves, reorder, shared documents, close safeguards; Q05 file CRUD, Unicode/paths, external changes and error recovery; Q06 CodeMirror keyboard editing/find/replace, quick-open, commands and focus; Q07 distinct IDE/Agent layouts and immutable run policies; Q08 fresh provider and approved agent workflows with controllable provider-boundary fixtures; Q09 CLI/VSIX installation and host integrations; Q10 bounded workload/stress/seeded interactions/30-minute soak; Q11 accessibility and actual screenshot review.

Native zoom checks must use host behavior; viewport resizing and CSS zoom are supplementary layout checks only. Unavailable native platforms or assistive technology will be marked unverified. Matrix and ledger will separate baseline defects, regressions, passed checks, and limitations.
