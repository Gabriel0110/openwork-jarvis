# AGENTS.md

Guidance for coding agents working in `openwork-atlas`.
This repository is an Electron + React + TypeScript desktop app.

NOTE: Always write great code. This is a non-negotiable.

## 1) Quick Start

- Use Node `>=20.19.0` for local and CI parity (`.nvmrc`, `.github/workflows/ci.yml`).
- Install dependencies with `npm ci` (preferred) or `npm install`.
- Primary dev command: `npm run dev`.
- Validation baseline: `npm run lint`, `npm run typecheck`, and `npm run test`; run `npm run test:smoke:build` for runtime/UI-risky changes.

## 2) Build, Lint, Typecheck, Test Commands

### Core commands

- Install deps: `npm ci`
- Start dev app: `npm run dev`
- Preview built app: `npm run start`
- Lint: `npm run lint`
- Typecheck (all): `npm run typecheck`
- Typecheck main/preload only: `npm run typecheck:node`
- Typecheck renderer only: `npm run typecheck:web`
- Production build: `npm run build`
- Format repo: `npm run format`
- Unit tests: `npm run test` or `npm run test:unit`
- Unit tests (watch): `npm run test:unit:watch`
- Smoke tests (requires build output): `npm run test:smoke`
- Build + smoke tests: `npm run test:smoke:build`

### Targeted / single-file checks

- Lint one file: `npx eslint src/renderer/src/App.tsx`
- Lint a folder: `npx eslint src/main`
- Check formatting for one file: `npx prettier --check src/main/index.ts`
- Apply formatting for one file: `npx prettier --write src/main/index.ts`

### Test status and single-test guidance

- Unit testing is configured with Vitest.
- Smoke testing is configured with Playwright.
- Run a single unit test file:
  - `npx vitest run tests/unit/title-generator.test.ts`
- Run a single unit test by name:
  - `npx vitest run tests/unit/title-generator.test.ts -t "returns short messages unchanged"`
- Run smoke tests against a built app:
  1. `npm run build`
  2. `npx playwright test tests/smoke/app-launch.spec.ts`

## 3) CI Expectations

- `lint-and-typecheck` on Ubuntu: `npm ci`, `npm run lint`, `npm run typecheck`
- `build` matrix on Ubuntu/macOS/Windows: `npm ci`, `npm run build`
- Minimum pre-PR checks: `npm run lint`, `npm run typecheck`, and `npm run test`
- Run `npm run build` for risky changes (Electron main process, build config, dependencies).

## 4) Project Layout

- `src/main/`: Electron main process, IPC handlers, agent runtime, DB/storage
- `src/main/zeroclaw/`: ZeroClaw managed runtime installer, supervisor, config, health/events bridge
- `src/preload/`: Electron preload bridge and API typing
- `src/renderer/src/`: React UI, state store, panels, chat/tabs, utilities
- `src/main/db/migrations/`: schema migrations and migration runner
- `tests/unit/`: unit tests (Vitest)
- `tests/smoke/`: desktop smoke tests (Playwright)
- `bin/cli.js`: CLI launcher
- `electron.vite.config.ts`: build/dev bundling config

ZeroClaw data and runtime layout (generated at runtime):

- `~/.openwork/zeroclaw/runtime/`: versioned managed ZeroClaw binaries
- `~/.openwork/zeroclaw/deployments/<deployment-id>/`: config/env/log artifacts per deployment
- DB tables: `zeroclaw_installations`, `zeroclaw_deployments`, `zeroclaw_runtime_events`, `zeroclaw_policy_bindings`

## 5) Style Rules (Enforced + Observed)

### Formatting

- Prettier is authoritative (`.prettierrc.yaml`):
  - double quotes
  - no semicolons
  - `printWidth: 100`
  - `trailingComma: none`
- EditorConfig defaults:
  - UTF-8
  - LF newlines
  - 2-space indentation
  - trim trailing whitespace
  - final newline required

### TypeScript and typing

- Prefer explicit types for public APIs and exported functions.
- Avoid `any`; use concrete interfaces/types or `unknown` with narrowing.
- Use `interface` for object contracts when it improves extension/readability.
- Keep shared domain types in `src/types.ts` and renderer-local types in `src/renderer/src/types.ts`.
- Use `import type` for type-only imports where practical.
- Validate required runtime inputs early and throw clear errors in main process code.

### Imports

- Keep import groups stable and readable:
  1. external packages
  2. internal alias imports (`@/...` or `@renderer/...`)
  3. relative imports
  4. type imports (often via `import type`)
- Prefer aliases in renderer code over deep relative paths.
- Avoid unused imports; keep lint clean.

### Naming conventions

- React components: `PascalCase` (`ChatContainer`, `ThreadSidebar`).
- Hooks/functions/variables: `camelCase` (`useCurrentThread`, `formatRelativeTime`).
- Constants: `UPPER_SNAKE_CASE` (`LEFT_DEFAULT`, `RIGHT_MAX`).
- Types/interfaces: `PascalCase` (`AppState`, `CreateAgentRuntimeOptions`).
- File names:
  - components: `PascalCase.tsx`
  - utility modules: `kebab-case.ts` or concise lowercase style consistent with folder

### React patterns

- Use functional components and hooks.
- Type exported component returns as `React.JSX.Element` when practical.
- Keep side effects in `useEffect` / `useLayoutEffect` with correct dependency arrays.
- Use `useMemo`/`useCallback` for expensive derivations or stable callback identity.
- Prefer small composable UI pieces under `components/`.

### State and data flow

- Zustand store (`src/renderer/src/lib/store.ts`) holds app-level UI and thread metadata.
- Thread-specific streaming/message state lives in `src/renderer/src/lib/thread-context.tsx`.
- Keep IPC boundaries explicit: renderer calls `window.api.*`, main validates and executes.

### Error handling and logging

- Main process: throw actionable errors for missing required config (API keys, workspace path).
- Renderer: catch async failures and surface useful UI-safe messages.
- Prefer structured, prefixed logs (existing pattern: `"[Store] ..."`, `"[Runtime] ..."`).
- Do not silently swallow errors unless intentionally non-critical and clearly justified.

### Electron/IPC safety

- Keep privileged operations in main/preload, not directly in renderer.
- Maintain explicit typing for IPC payloads and responses.
- Preserve user approval flow semantics around filesystem/shell capabilities.

## 6) Lint Rules Snapshot

- ESLint stack:
  - `@eslint/js` recommended
  - `@electron-toolkit/eslint-config-ts` recommended
  - React + hooks + react-refresh recommended configs
  - Prettier compatibility config last
- Ignored paths: `node_modules`, `dist`, `out`
- `@typescript-eslint/explicit-function-return-type` is currently disabled.

## 7) Cursor / Copilot Rules

- No `.cursorrules` file is present.
- No `.cursor/rules/` directory is present.
- No `.github/copilot-instructions.md` file is present.
- If these files are added later, update this section and treat them as higher-priority guidance.

## 8) Agent Workflow Recommendations

- Before editing: inspect nearby modules for naming/import/style consistency.
- After editing: run targeted lint, then full lint + typecheck.
- For non-trivial changes: run build before handoff.
- For non-trivial runtime/UI changes: run `npm run test` and `npm run test:smoke:build`.
- Keep diffs focused; avoid unrelated refactors.
- Update docs (`README.md`, `CONTRIBUTING.md`, this file) when commands or conventions change.

## 9) Definition of Done

- Code is formatted and lint-clean.
- Typecheck passes for node and web targets.
- Build passes locally when change risk warrants it.
- Behavior changes are documented where future contributors need context.
- No secrets, API keys, or local machine artifacts are committed.

## Workflow Orchestration

### 1. Plan Mode Default

- Enter plan mode for ANY non-trivial task (3+ steps or architectural decisions)
- If something goes sideways, STOP and re-plan immediately — don't keep pushing
- Use plan mode for verification steps, not just building
- Write detailed specs upfront to reduce ambiguity

### 2. Subagent Strategy

- Use subagents liberally to keep main context window clean
- Offload research, exploration, and parallel analysis to subagents
- For complex problems, throw more compute at it via subagents
- One task per subagent for focused execution

### 3. Self-Improvement Loop

- After ANY correction from the user: update `tasks/lessons.md` with the pattern
- Write rules for yourself that prevent the same mistake
- Ruthlessly iterate on these lessons until mistake rate drops
- Review lessons at session start for relevant project

### 4. Verification Before Done

- Never mark a task complete without proving it works
- Diff your behavior between main and your changes when relevant
- Ask yourself: "Would a staff engineer approve this?"
- Run tests, check logs, demonstrate correctness

### 5. Demand Elegance (Balanced)

- For non-trivial changes: pause and ask "is there a more elegant way?"
- If a fix feels hacky: "Knowing everything I know now, implement the elegant solution"
- Skip this for simple, obvious fixes — don't over-engineer
- Challenge your own work before presenting it

### 6. Autonomous Bug Fixing

- When given a bug report: just fix it. Don't ask for hand-holding
- Point at logs, errors, failing tests — then resolve them
- Zero context switching required from the user
- Go fix failing CI tests without being told how

## Task Management

1. **Plan First**: Write plan to `tasks/todo.md` with checkable items
2. **Verify Plan**: Check in before starting implementation
3. **Track Progress**: Mark items complete as you go
4. **Explain Changes**: High-level summary at each step
5. **Document Results**: Add review section to `tasks/todo.md`
6. **Capture Lessons**: Update `tasks/lessons.md` after corrections

## Core Principles

- **Simplicity First**: Make every change as simple as possible. Impact minimal code.
- **No Laziness**: Find root causes. No temporary fixes. Senior developer standards.
- **Minimal Impact**: Changes should only touch what's necessary. Avoid introducing bugs.
