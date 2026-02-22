# TODO

## Workspace File Mentions in Chat (Current Task)

- [x] Add `@` mention parsing + autocomplete UI in chat composer (keyboard + click selection)
- [x] Reuse workspace file inventory for suggestions with sensible filtering/ranking
- [x] Resolve mentioned file paths in main process and build safe, bounded context blocks
- [x] Inject file context into agent/ZeroClaw invocation payloads without polluting displayed user messages
- [x] Add unit tests for mention parsing/context assembly edge cases
- [x] Validate with lint + typecheck + targeted tests

## Full PTY Terminal Upgrade (Current Task)

- [x] Audit existing terminal dock + IPC integration state
- [x] Replace renderer command-console dock with xterm PTY terminal (TUI support)
- [x] Align preload API + renderer typings with PTY contract
- [x] Ensure main IPC handlers match PTY methods and remove stale command methods
- [x] Fix dock viewport clipping and wire robust resize/fit behavior
- [x] Validate with lint + typecheck + build

## Harness Engineering Program (New)

- [x] Upgrade `deepagents` and align LangChain dependency stack
- [x] Stabilize SDK/runtime compatibility after dependency upgrades
- [x] Tranche 0: add `0015-harness-core` migration + harness repository modules + typed IPC/preload skeleton
- [x] Tranche 1: implement benchmark corpus loader/runner/scoring + trace normalization/export/redaction (`W1`/`W2`)
- [x] Tranche 2: implement trace analyzer, finding review lifecycle, experiment runner, promotion policy (`W3`/`W4`)
- [x] Tranche 3: add runtime middleware hardening and stop-reason instrumentation (`W5`)
- [x] Tranche 4: add harness metrics aggregation + diagnostics surfaces (`W6`)
- [x] Tranche 5: add Harness UI route + run/detail/findings/experiments/metrics views (`W7`)
- [x] Tranche 6: add CI/nightly harness workflows and gate phasing toggles (`W8`)
- [x] Tranche 7: add N1-N7 novel extension contracts/stubs + env flags

## Harness Engineering Follow-Up (Current)

- [x] Implement experiment sample matrix execution (`sampleSize`) with retry handling (`retryCount`)
- [x] Aggregate variant metrics across samples (score/cost/tool/latency/safety deltas) for promotion decisions
- [x] Persist and apply promotion outcomes to subsequent harness suite runs
- [x] Add richer harness metrics cards + gate report visibility in Harness UI
- [x] Add detailed experiment variant diagnostics table in Harness UI
- [x] Add trace export format controls (`json`, `jsonl`, `summary`) and serialized preview support
- [x] Expand CI gate workflow to staged mode resolution (`observe` -> `soft`, override-capable)
- [x] Expand nightly workflow with gate evaluation + artifact retention command
- [x] Validate with lint + typecheck + test + build

## Review

- Implemented a real PTY-backed terminal dock using `node-pty` + `@xterm/xterm`, enabling TUI apps.
- Added PTY lifecycle operations across IPC/preload (`connect`, `input`, `resize`, `kill`, `restart`, `dispose`).
- Replaced line-buffered command UX with interactive streaming terminal rendering and keyboard input passthrough.
- Added clipboard copy/paste shortcuts and robust `ResizeObserver` + fit synchronization to avoid viewport clipping.
- Added terminal session cleanup on thread deletion and app shutdown.
- Added runtime auto-repair for `node-pty` `spawn-helper` execute permissions on macOS to prevent `posix_spawnp failed` startup errors.
- Adjusted dock container/footer sizing to reduce bottom-edge clipping.
- Externalized `node-pty` in Electron main build config for native runtime compatibility.
- Validation completed:
  - `npm run typecheck`
  - `npm run lint`
  - `npm run build`
  - `npm run test`
  - `npm run test:smoke:build`
- Dependency upgrade tranche completed:
  - `deepagents` upgraded to `1.8.0`
  - LangChain stack aligned (`langchain`, `@langchain/core`, `@langchain/langgraph`, provider packages)
  - Post-upgrade compatibility fixes applied in runtime/IPC/renderer stream typing
- Harness engineering tranche completed:
  - Added `0015-harness-core` DB migration with run/task/artifact/trace/finding/experiment/gate/metric tables and indexes
  - Added harness repositories (`harness-runs`, `harness-traces`, `harness-findings`, `harness-experiments`, `harness-metrics`)
  - Added harness domain (`benchmark-loader`, `benchmark-runner`, `scoring`, `trace-export`, `redaction`, `trace-analyzer`, `experiment-runner`, `promotion-policy`, `retention`, `novel` stubs)
  - Added runtime hardening middleware (`budget-controller`, `loop-detection`, `pre-completion-checklist`, `stop-reason`) and integrated deterministic middleware order in agent runtime
  - Added full harness IPC + preload API surface (`window.api.harness.*`)
  - Added renderer Harness operator surface with run table/detail, findings review, experiments compare/promotion, and trace inspector
  - Added benchmark/experiment/analyzer assets under `harness/`
  - Added harness CLI scripts and npm commands (`harness:run`, `harness:run:suite`, `harness:score:recompute`, `harness:gate`)
  - Added CI observe-stage harness job and nightly harness workflow
  - Added unit tests for benchmark loader, redaction, promotion policy, plus migration coverage for harness schema
  - Validation completed:
    - `npm run typecheck`
    - `npm run lint`
    - `npm run test`
    - `npm run build`
    - `npm run test:smoke:build`
- Harness follow-up tranche completed:
  - Experiment runner now executes statistically meaningful sample runs and retries, then aggregates deltas per variant before promotion policy evaluation.
  - Promotion now records the selected variant and subsequent harness suite runs automatically apply promoted variant config unless explicitly overridden.
  - Harness metrics include active/queued/completion/finding distribution and are rendered as at-a-glance cards.
  - Harness view now surfaces gate report history and richer experiment diagnostics (n/retries/score+safety+latency deltas).
  - Trace exports now honor format semantics (`json`, `jsonl`, `summary`) with serialized payload preview in the inspector.
  - CI harness gate now resolves staged mode dynamically with override support; nightly now runs gate evaluation and artifact retention.
  - Validation completed:
    - `npm run lint`
    - `npm run typecheck`
    - `npm run test`
    - `npm run build`
- Harness execution realism tranche completed:
  - Replaced synthetic-only benchmark task execution path with real deep-agent runtime execution per task in isolated harness workspaces.
  - Added per-task harness thread execution, stream parsing, live tool call accounting, approval-interrupt detection, and runtime stop-reason capture.
  - Added task-level assistant output artifacts and linked harness trace export discovery to task thread IDs for richer diagnostics.
  - Added safe fallback switch via `HARNESS_SYNTHETIC_ONLY=true`, and isolated workspace control via `HARNESS_ISOLATED_WORKSPACE=false`.
  - Validation completed:
    - `npm run lint`
    - `npm run typecheck`
    - `npm run test`
    - `npm run build`
- Harness UX/retention follow-up completed:
  - Added a visible Harness run mode selector (`Live` / `Synthetic`) in the Harness page and passed mode selection into run start payloads.
  - Added per-run task execution mode plumbing (`taskExecutionMode`) through shared types and preload bridge.
  - Added harness retention cleanup for isolated workspace copies under `~/.openwork/harness/workspaces`.
  - Extended retention result reporting to include removed workspace copy count and surfaced it in Harness UI status messaging.
  - Validation completed:
    - `npm run lint`
    - `npm run typecheck`
    - `npm run test`
    - `npm run build`
- Workspace file mention support completed:
  - Added `@file` autocomplete in the chat composer using current workspace file inventory.
  - Implemented keyboard (`↑`/`↓`/`Enter`/`Tab`/`Esc`) and mouse selection for mention insertion at cursor.
  - Added main-process mention resolution with workspace confinement, traversal protection, size/binary guards, and truncation limits.
  - Injected mention-derived file context into runtime/ZeroClaw request context without altering displayed user chat messages.
  - Added Codex/Cursor-style attached file chips in composer with click-to-open and remove affordances.
  - Added explicit `referencedFiles` transport path so selected chips are passed as context attachments even when not left inline in message text.
  - Disabled composer spellcheck/autocorrect to avoid macOS NSSpellServer first-mention stalls.
  - Added unit coverage for mention extraction/context assembly (`tests/unit/workspace-file-mentions.test.ts`).
  - Validation completed:
    - `npm run lint`
    - `npm run typecheck`
    - `npm run test`
    - `npm run build`
