# Lessons

- For terminal features, implement PTY + xterm from the start; line-buffered command consoles are insufficient for TUIs and create UX regressions.
- On macOS with `node-pty`, verify `spawn-helper` execute permissions (`0o755`) at runtime and auto-repair if needed; missing execute bits cause `posix_spawnp failed`.
