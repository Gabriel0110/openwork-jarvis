# Contributing to openwork-atlas

Thanks for contributing.

## Prerequisites

- Node.js `>=20.19.0` (see `/Users/gtomberlin/Documents/Code/openwork-atlas/.nvmrc`)
- npm 10+
- Git

## Setup

```bash
npm ci
npm run dev
```

## Project Structure

```text
src/main/       Electron main process, runtime, IPC, DB/storage
src/preload/    Context bridge and typed API surface
src/renderer/   React UI and client state/transport
docs/           Architecture and product docs
tests/          Unit and smoke tests
```

## Quality Gates

Run these before opening a PR:

```bash
npm run lint
npm run typecheck
npm run test
npm run build
```

Smoke tests for packaged app behavior:

```bash
npm run test:smoke:build
```

## Testing

- Unit tests: Vitest (`/Users/gtomberlin/Documents/Code/openwork-atlas/tests/unit`)
- Smoke tests: Playwright Electron launch checks (`/Users/gtomberlin/Documents/Code/openwork-atlas/tests/smoke`)

## Coding Rules

1. Keep IPC payloads strictly typed.
2. Keep privileged operations in main/preload, not renderer.
3. Add DB changes via migrations only.
4. Keep diffs focused; avoid unrelated refactors.

## Commit Conventions

Use conventional commit prefixes:

- `feat:`
- `fix:`
- `docs:`
- `refactor:`
- `test:`
- `chore:`
