# Reproducible verification

Run from the repository with Node 22+ after `npm ci`. No paid provider calls are needed. Browser tests use a local HTTP provider fixture but retain the real service, engine, approvals, files and persistence. Each browser test gets a separate temporary workspace, config, token and ephemeral port. No retries conceal failures.

| Command | Scope |
|---|---|
| `npm run test:smoke` | Types, 32 core tests, production build |
| `npm run test:e2e` | Editor, agent, catalog, two-window races, accessibility, stress and screenshot checks. The 30-minute test is explicitly skipped here. |
| `npm run test:cli` | Built CLI: JSON, revisions, real host demo, Unicode paths, media flags, SIGINT and exit status |
| `python3 scripts/cli-pty.py [installed-cli.cjs]` | POSIX real pseudo-terminal: approve changes, reject tests, and Ctrl+C while an approval prompt is active |
| `npm run test:extension` | Clean VS Code profile; native file save, split, real webview, host zoom and disposal/reopen |
| `NEXUS_VSIX=../nexuside-local-qa/nexuside-0.2.0.vsix npm run test:extension` | Install actual local package first (POSIX shell syntax) |
| `NEXUS_CLI=/absolute/installed/nexuside/dist/cli.cjs npm run test:cli` | Verify an installed npm package |
| `npm run test:sandbox` | Docker browser allowlist, blocked domains/protocols, no direct network route |
| `npm run test:stress` | 100 documents, four groups, seed 230923, 201 real runs, long trace/diff, accessibility and responsive screenshots |
| `npm run test:soak` | Real 1,800-second local UI workload; input, files, groups, modes, requests, CPU, heap, event-loop delay and long tasks |
| `npm run test:performance` | Five fresh browser contexts per version/tier against the baseline sibling `../nexuside`; 10/100/1,000/10,000 files |
| `npm run package:vsix` / `npm run package:cli` | Local artifacts only; build first |

PowerShell environment example: `$env:NEXUS_VSIX='../nexuside-local-qa/nexuside-0.2.0.vsix'; npm run test:extension`. `NEXUS_SEED` sets the soak seed; `NEXUS_SOAK_SECONDS` can shorten a development run, but a short run is not a 30-minute soak. `NEXUS_SOAK_LABEL` keeps reports from different builds distinct. Each soak report records the SHA-256 of the browser bundle actually loaded. Retain failures and earlier interrupted engineering runs; do not count them as completed soaks.

Evidence is written to the sibling `nexuside-qa-evidence` directory. Browser failures retain video, screenshot and Playwright trace in `test-results-interactions`. The suite catches real UI errors; API requests are used only for fixture preparation and persisted-state checks. Intentional transport delay tests still forward to the real service.

Native VS Code foreground actions are conditional on `window.state.focused`. This machine reports false even when CDP DOM focus is true; the actual native comment/undo assertions remain in the suite and are explicitly blocked here. Set `NEXUS_REQUIRE_NATIVE_FOCUS=1` to require them. Host zoom is measured through real renderer scale, not inferred from a viewport or CSS transform. At non-default zoom the CDP pointer coordinates can hit an adjacent host pane; keyboard dialog checks and screenshots do not prove pointer/caret alignment. Physical shortcuts remain a separate host check.

CLI subprocess tests run on the host OS. Docker Linux checks do not prove Linux desktop, PowerShell or Windows behavior. This revision's CI workflow is configured for all three OSes, but has not been pushed/dispatched as part of the local assignment. Do not call configured jobs passed runs.

Provider unit fixtures cover native adapters and OpenRouter media/routing/privacy/cost serialization. Local fixtures cannot verify current model availability, production billing, account permissions or real inference quality. No credentials or spending limit were supplied. The packaged app supports provider configuration after installation.
