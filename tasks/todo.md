# TODO

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
- [ ] Implement benchmark corpus + scoring harness (`W1`)
- [ ] Implement normalized trace export layer (`W2`)
- [ ] Implement parallel subagent trace analyzer + review gate (`W3`)
- [ ] Implement experiment/ablation engine + promotion rules (`W4`)
- [ ] Implement runtime harness hardening middleware (`W5`)
- [ ] Implement approval quality metrics and diagnostics (`W6`)
- [ ] Implement Harness operator UI (`W7`)
- [ ] Implement CI/nightly harness merge gates (`W8`)

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
