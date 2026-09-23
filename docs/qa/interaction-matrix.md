# Interaction matrix

Finite coverage of this local QA build. Passed applies to the listed assertions, not every possible state or input method. See [the CSV](interaction-matrix.csv) for preconditions, input paths, expected states and evidence.

| ID | Journey | Surface / owner | Result | Test | Limitation |
|---|---|---|---|---|---|
| M01 | Agent landing, new task, model/priority selectors | Browser / Implemented by NexusIDE | Passed | workspace / provider tests | Listed assertions only |
| M02 | IDE/Agent layout and persistent draft/buffers | Browser / Implemented by NexusIDE | Passed | E01 / Q08 | Listed assertions only |
| M03 | Existing run mode/config and IDE execution policy | Shared / Implemented by NexusIDE | Passed | Q08 / E01 | All future changes still need review; no inference-quality claim |
| M04 | Explorer/filter/exact-path quick-open | Browser / Implemented by NexusIDE | Passed | E01 / E04 / E08 | Explorer is a path list with folders, not a collapsible tree |
| M05 | Workspace literal content search | Browser/shared / Implemented by NexusIDE | Passed | E10 / workspace unit tests / performance | Literal search UI result opens the correct document; every keyboard-only search combination is not asserted |
| M06 | File creation and nested Unicode paths | Browser / Implemented by NexusIDE | Passed | E03 / Q04 / C01 | Listed assertions only |
| M07 | Folder creation | Browser/shared / Implemented by NexusIDE | Passed | E10 / Q04 | Nested folder verified on disk |
| M08 | File/folder rename | Browser/shared / Implemented by NexusIDE | Passed | E03 / Q04 | Case-only rename on case-insensitive volumes is not supported |
| M09 | Deletion and recovery trash | Browser/shared / Implemented by NexusIDE | Passed | E03 / Q04 | Trash has no cleanup browser; remove old .nexus/trash items with host tools |
| M10 | Binary/encoding/size errors | Browser/shared / Implemented by NexusIDE | Passed | E08 / Q05 | Listed assertions only |
| M11 | Path/link/credential boundaries | Shared / Implemented by NexusIDE | Passed | core / Q04 | Adversarial OS-level path replacement during a syscall is outside this finite audit |
| M12 | Permission denial | Shared / Implemented by NexusIDE | Passed | E14 | Actual POSIX EACCES on macOS; Windows ACL denial unverified |
| M13 | External changes and deleted open files | Browser/shared / Implemented by NexusIDE | Passed | E03 / E10 / Q03 | Five-second snapshot polling; no filesystem event watcher |
| M14 | Multiple tabs and dirty/active indicators | Browser / Implemented by NexusIDE | Passed | E01 / E02 / S02 | Listed assertions only |
| M15 | Selection, scroll and undo per document | Browser / Implemented by NexusIDE | Passed | E01 / E04 / E11 | Numerical long-scroll restoration, selection via go-to-line edits and independent/shared undo verified; every split-scroll combination is not asserted |
| M16 | Tab drag reorder and group moves | Browser / Implemented by NexusIDE | Passed | E04 / E06 | Listed assertions only |
| M17 | Edge drops and cancelled drag | Browser / Implemented by NexusIDE | Passed | E06 | Physical touch and native zoom pointer coordinates unverified |
| M18 | Horizontal/vertical splits, resize, focus, close | Browser / Implemented by NexusIDE | Passed | E01 / E02 / E04 / E09 / E15 / S01 / S02 | Pointer and keyboard resizing verified; physical touch and drag coordinates at native zoom remain unverified |
| M19 | Shared document views | Browser / Implemented by NexusIDE | Passed | E01 / E02 / E04 | Listed assertions only |
| M20 | Save, Save All, duplicate saves, newer typing | Browser/shared / Implemented by NexusIDE | Passed | E01 / E05 / E09 / Q03 | Browser ControlOrMeta uses current macOS convention; physical Windows shortcuts unverified |
| M21 | Autosave | Browser / Implemented by NexusIDE | Passed | E13 | Idle save verified; every autosave/external-change timing combination unverified |
| M22 | Save/Discard/Cancel last-view close | Browser / Implemented by NexusIDE | Passed | E02 / E13 | Save, Cancel and Discard asserted against real disk contents |
| M23 | Reload and recovery | Browser/VS Code / Implemented by NexusIDE | Passed | E01 / VS suite | Undo history restarts after reload; no guarantee for unacknowledged keystrokes at power loss |
| M24 | Interrupted multi-file write recovery | Shared / Implemented by NexusIDE | Passed | Q07 | Deterministic interrupted-state fixture; physical power loss/fsync guarantees untested |
| M25 | Indent/newline/comments/word wrap | Browser / Implemented by NexusIDE | Passed | E07 | Listed assertions only |
| M26 | Find/replace/case/regex feedback | Browser / Implemented by NexusIDE | Passed | E04 / E07 / E15 | Find/replace, case-sensitive behavior and invalid regex feedback verified; not every regex expression is covered |
| M27 | Go-to-line/brackets/line movement | Browser / Implemented by NexusIDE | Passed | E11 / E15 | Go-to-line, line movement and matching-bracket decoration verified in the tested language/document |
| M28 | Copy/cut/paste and multiple cursors | Browser / Implemented by NexusIDE | Partial | E11 / E04 | Multicursor replacement and multiline input verified; real system clipboard round trip unverified |
| M29 | Unicode/emoji/combining/CRLF/LF | Browser/shared / Implemented by NexusIDE | Passed | E07 / C01 | Real IME composition remains unverified |
| M30 | IME and physical touch | Browser / Unavailable in this environment | Blocked | — | Synthetic composition/touch would not prove hardware behavior |
| M31 | Syntax highlighting | Browser / Implemented by NexusIDE | Partial | E04 / screenshots | All advertised languages not individually syntax-tested |
| M32 | Browser LSP, formatting, diagnostics, symbols, debugger, terminal | Browser / Separate product capability | Untested | Inventory | Use actual VS Code host capabilities; no decorative controls added |
| M33 | Quick-open/commands/sidebar/group shortcuts | Browser / Implemented by NexusIDE | Partial | E04 / E09 / V01 | Save/Save All, quick-open/palette, tab arrows/Ctrl+PageUp, sidebar and group focus verified; physical Windows/Ctrl variants and shortcut split keys not all asserted |
| M34 | Dialog focus trapping and return | Browser / Implemented by NexusIDE | Passed | V01 | Real screen-reader announcement unverified |
| M35 | Native browser zoom keys | Browser / Host-provided | Blocked | Code review | No viewport/CSS transform used as shortcut proof |
| M36 | VS Code zoom commands and 80–200% host configuration | VS Code / Host-provided | Partial | VS suite | Actual host DPR and keyboard dialog at 80–200% in a joined host group; physical shortcuts and pointer/caret alignment remain unverified |
| M37 | No configured provider and invalid credential | Shared/browser / Implemented by NexusIDE | Passed | core / provider tests | No live credentials used |
| M38 | Credential save/replace/remove | Browser/VS Code / Implemented by NexusIDE | Partial | P01 | Browser session save/replacement/removal and no key in state verified; actual VS Code OS keychain round trip unverified |
| M39 | Manual model and automatic routing | Shared/browser / Implemented by NexusIDE | Passed | core / OpenRouter / workspace tests | Listed assertions only |
| M40 | OpenRouter catalog/search/import/duplicates | Browser/shared / Implemented by NexusIDE | Passed | workspace catalog / OpenRouter unit tests | Unavailable/deleted production catalog models not live-tested |
| M41 | OpenRouter preferences, ceilings, fallback/privacy/modalities | Browser/shared / Implemented by NexusIDE | Passed | OpenRouter tests / catalog UI | Provider enforcement and production pricing not verified |
| M42 | Media boundaries | CLI/shared / Implemented by NexusIDE | Passed | C04 / Q09 / provider tests | Real content decoding/inference quality unverified |
| M43 | Plan/read/propose/review/apply/tests/result | Browser/shared / Implemented by NexusIDE | Passed | workspace journey / core offline journey | Listed assertions only |
| M44 | Reject/cancel/resume/restart | Browser/CLI/shared / Implemented by NexusIDE | Passed | core recovery / C01 / C04 | Every timing boundary is not exhaustively covered |
| M45 | Delayed old approval, two clients, replay | Browser/shared / Implemented by NexusIDE | Passed | Q01 / Q02 / A01 | Listed assertions only |
| M46 | Duplicate submissions | Shared / Implemented by NexusIDE | Passed | Q06 | Semantically different requests with identical caller UUID are not a supported client pattern |
| M47 | File edited after proposal | Shared / Implemented by NexusIDE | Passed | core / Q03 | Listed assertions only |
| M48 | Budget/step limits and provider faults | Shared / Implemented by NexusIDE | Partial | providers / recovery tests | Full timeout duration, every malformed schema and disconnect combination not tested |
| M49 | Trace integrity, export, evaluations and reported cost | Browser/shared / Implemented by NexusIDE | Passed | core / OpenRouter / S03 / workspace journey | JSONL export content covered by backend; actual browser download click not separately asserted |
| M50 | Hundreds of runs/long trace/long diff | Browser/shared / Implemented by NexusIDE | Passed | S03 | Listed assertions only |
| M51 | CLI installation and JSON/exit status | macOS CLI / Implemented by NexusIDE | Passed | C01–C04 | Fresh actual npm archive installed locally; see package manifest |
| M52 | CLI Linux runtime | Linux container / Implemented by NexusIDE | Passed | Linux actual package installation | Node 22 Alpine container with network disabled; not Linux desktop or every shell |
| M53 | Windows/PowerShell/npm.cmd and Node lookup | Windows CLI/VS Code / Unavailable in this environment | Blocked | Configured CI | This local revision has not run on Windows; code checks and Linux/macOS are not Windows evidence |
| M54 | Interactive CLI prompt | Terminal / Implemented by NexusIDE | Passed | POSIX PTY two scenarios | Actual pseudo-terminal y/n approval and Ctrl+C at pending approval verified; Windows terminal and full chat conversation unverified |
| M55 | VSIX actual install/activation/webview/native save | VS Code / Implemented by NexusIDE | Passed | VS suite | Actual package installed into a clean profile |
| M56 | Native file editing, splits and host integrations | VS Code / Host-provided | Partial | VS suite | Native API edit/save and split verified; foreground comment/undo/physical shortcut assertions blocked and retained in suite |
| M57 | Inline suggestion accept/dismiss/stale edits | VS Code / Implemented by NexusIDE | Untested | Code inventory | No live inference or complete host suggestion lifecycle test |
| M58 | Webview dispose/reopen/theme/trust | VS Code / Implemented by NexusIDE | Partial | VS suite | Actual trust-denial UI and full host reload/crash sequence unverified |
| M59 | Docker allowed browser and denied domains | Shared/Docker / Implemented by NexusIDE | Passed | sandbox integration | Baseline first attempt failed at Docker network creation; retained as M60 |
| M60 | Baseline Docker network creation | Docker / Host-provided | Failed (baseline) | baseline sandbox | Rerun later passed; no root-cause claim beyond daemon response |
| M61 | Docker unavailable/slow/interrupted cleanup | Shared/Docker / Implemented by NexusIDE | Untested | — | Did not stop user Docker daemon or interrupt unrelated containers |
| M62 | Concurrent file clients | Shared / Implemented by NexusIDE | Passed | Q03 | Listed assertions only |
| M63 | 1,200 entry/depth and 10,000-file over-limit | Shared/browser / Implemented by NexusIDE | Passed | Q05 / performance | Dedicated deep-tree and max-OS-path-length fixture untested |
| M64 | Seeded randomized navigation | Browser / Implemented by NexusIDE | Passed | S02 | Not an exhaustive state-space search |
| M65 | 30-minute browser soak | Browser/shared / Implemented by NexusIDE | Passed | S01 | Completed elapsed duration, heap/CPU and request limits are in QA-REPORT.md; earlier failed/interrupted engineering runs remain separate |
| M66 | Poll overlap on run selection | Browser / Implemented by NexusIDE | Passed | A02 / S01 | One state and one selected-run request in flight per client in this workload |
| M67 | Performance budgets and before/after | Browser/shared / Implemented by NexusIDE | Partial | performance / S02 / S03 | File-open budget misses and sample limits are reported in performance.md. p95 of five is the maximum; input event-to-paint is browser-event timing, not physical-key latency |
| M68 | Desktop/small/high-DPI/reduced-motion visuals | Browser/VS Code / Implemented by NexusIDE | Passed | V01 / VS suite | Physical touchscreen, Safari and native browser zoom unverified |
| M69 | Accessibility semantics/contrast/focus | Browser / Implemented by NexusIDE | Passed | S02 / V01 | Scanner result is not full accessibility conformance or real assistive-technology verification |
| M70 | Original session/release preservation | Workspace/GitHub / Implemented by NexusIDE | Passed | Baseline/final status | Artifacts are local and unpublished |
| M71 | Rapid file selection with a slow earlier load | Browser / Implemented by NexusIDE | Passed | E12 | Ten independent fixtures; no retries |
