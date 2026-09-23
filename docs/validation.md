# Release validation

The initial release was validated on macOS arm64 with Node.js 22, a clean VS Code 1.139 runtime, Playwright Chromium, and Docker Desktop. Provider API contracts were exercised against local HTTP fixtures; no paid provider requests or user credentials were used.

## Automated coverage

- Core/provider/service tests: workspace traversal, credential paths, Windows aliases, symbolic and hard links; multi-file conflict protection; model tiers and modalities; hash-chain tampering; successful/rejected/cancelled agent workflows; native API payloads; OpenRouter multimodal/routing/privacy payloads, catalog filtering, reasoning-state continuation and complete approved agent cycle; fallback; budgets; cross-process cancellation; Git commits preserving unrelated staged content; localhost token/Host/Origin enforcement.
- Browser suite: fresh task → diff review → apply → separately approve tests → verified result → edit/save → trace → evaluations. Also rejection, IDE mode, OpenRouter catalog import and saved routing preferences, settings, CLI help, and 390 × 844 mobile layout.
- VS Code integration: clean extension activation, registration of all four commands, and creation of the NexusIDE workspace webview.
- Docker integration: actual navigation to an allowlisted public page, action screenshots, refusal of unapproved protocols/domains, and proof that the internal network has no direct public egress.
- CLI distribution: tarball installed into an isolated npm prefix and the no-key demo run from the installed command. VSIX manifest and included runtime verified; extension tested in a separate VS Code profile.

GitHub Actions repeats core/CLI validation on Windows, macOS, and Linux; browser, extension and Docker validation run on Linux. The release workflow publishes only after these gates pass.

## Visual and interaction review

The reference is `docs/design-reference.png`, generated using the built-in image tool. The primary prompt specified a complete charcoal/mint NexusIDE workspace with file rail, IDE/Agent switch, staged code diff, composer, approval controls and activity inspector. The production review screenshot is `docs/dashboard.png`; the mobile result is `docs/mobile.png`.

The Browser plugin was not available, so Playwright was used. Both the reference and the actual screenshots were opened and visually inspected. Comparison points: charcoal palette and mint accent; three-column hierarchy; type sizing and density; flat diff panels; approval placement; composer and model selectors; timeline and routing inspector. Desktop (1536 × 1024) and mobile (390 × 844) were inspected for clipping, overflow and control usability. A stale approval-button state was found and fixed, then covered by the full interaction test. A missing favicon was also fixed.

The implementation faithfully follows the reference's structure and visual system. Intentional differences are real file names/code, actual trace timestamps, explicit Reject/Cancel controls, a new Evaluations navigation item required by the brief, and responsive collapse of the sidebar/inspector. The reference's sample content is not fabricated as live data. Visible copy matches the implemented workflow; fixture names and counts reflect actual files. No material layout mismatch remains in the reviewed states.

## Practical limits

No live OpenAI/Anthropic/Gemini/OpenRouter account inference calls were made because the user chose to configure providers after installation. Inline completion registration was verified, but generated inline text requires a live provider. Test success establishes the covered workflows, not arbitrary-task correctness. Browser automation covers web content in Docker, not the host desktop. Audio and video are file attachments; realtime capture is outside this release. Estimated costs are not billing guarantees. See the README's execution and data boundaries before choosing host test mode.
