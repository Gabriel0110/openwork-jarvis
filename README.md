# openwork-atlas

Openwork-Atlas is a local-first desktop app for running a personal multi-agent AI workspace.
It is built on top of deepagents and the Openwork architecture baseline, then extended for
agent orchestration, policy-gated actions, and operator-focused observability.

![openwork screenshot](docs/screenshot.png)

> [!CAUTION]
> This app can execute shell commands and modify files in linked workspaces. Keep approval
> gates enabled for destructive actions and only use trusted directories.

## What Openwork-Atlas Adds Over OpenWork

### Highlights

- Multi-agent control plane with agent registry, orchestrator delegation contracts, and role-specific default roster seeding.
- Strong policy/safety model with per-agent policy rules, global security defaults, and runtime enforcement overlays.
- Deep timeline observability across tool calls, approvals, subagent lifecycle, triggers, scheduled runs, and errors.
- Workflow templates with import/export, session-derivation, triggers, scheduling, automation directives, and scheduler durability.
- Graph topology workspace with persisted layouts, delegation/tool/memory edges, and department grouping.
- Memory + local RAG system with source indexing, search, memory locks, restore-as-new, and audit visibility.
- Skills + tools platform with global skill discovery, per-agent skill modes, tool registry CRUD, and custom runtime script tools.
- Prompt repository system for reusable markdown assets (`AGENTS.md` + generic prompts), workspace/agent bindings, and conflict-safe materialization.
- Connectors + MCP management surfaces with bundle portability, redaction-safe import/export, telemetry, and trigger simulation.
- ZeroClaw first-class integration with managed runtime lifecycle, deployment policies, threaded chat speaker mode, and diagnostics.
- Harness engineering system with benchmark suites, trace exports, failure analysis, experiment promotion workflow, runtime hardening metrics, and CI/nightly quality signals.
- `@` workspace file mentions with autocomplete, attached-file chips, click-to-open behavior, and bounded context injection into agent/ZeroClaw runs.
- Operator-oriented Home/Settings UX for health, approvals, scheduler/runtime status, local paths, and secure-default controls.

### Detailed Capability Additions

#### Multi-Agent Runtime and Orchestration

- Agent registry CRUD with model/provider, role/system prompt, memory scope, tool/connector allowlists, skill modes, tags, and orchestrator flag.
- PRD-aligned default agent pack seeding for new workspaces.
- Direct per-agent chat, orchestrator routing context, and one-click sanity test sessions.
- Persisted delegation contracts and subagent start/completion timeline events.

#### Policy, Security, and Human Approval

- Workspace policy engine spanning tool/filesystem/network/connector resources.
- Policy decisions: `allow`, `ask`, `deny`, `allow_in_session`.
- Session policy grants for approval-scoped temporary access.
- Global security defaults persisted in settings: exec approval, network approval, deny social posting.
- Runtime safety overlays that downgrade/deny risky actions under global guardrails.
- Explicit in-chat approval action card with Approve/Reject controls and approval decision timeline audit entries.

#### Sessions, Timeline, and Auditability

- Session sidebar search and status filters (`all`, `active`, `blocked`, `zeroclaw`) plus metadata chips.
- Thread timeline with typed event rendering and workspace-scoped query support.
- Timeline event classes for user/tool/subagent/approval/template-trigger/error flows.
- Trigger-focused timeline mode and quick-open actions to templates and run threads.
- Disk-change and activity observability signals for recent workspace operations.

#### Templates, Triggers, Scheduling, and Automations

- Template CRUD with expected artifacts, policy defaults, memory defaults, tags, and speaker defaults.
- Template import/export with JSON and YAML support and auto-detection.
- “Create from session” derivation pipeline for starter prompts, artifacts, connector hints, and policy seeds.
- Trigger authoring and runtime for `timeline_event`, `connector_event`, and `webhook` types.
- Trigger execution modes (`notify`, `auto_run`) with loop-prevention guardrails.
- External trigger ingestion IPC and in-app trigger simulation tools.
- Persistent scheduler for RRULE-based template runs with restart-safe run tracking.
- Schedule observability via dedicated audit events and schedule-run query surfaces.
- Automation draft + directive builders for copyable `::automation-update{...}` output.

#### Graph and Workspace Topology

- Interactive graph of agent topology with persisted node positions per workspace.
- Visual overlays for delegation edges, shared tool/connector edges, and shared memory edges.
- Department/tag grouping mode and simulation controls.
- Node-level quick actions for chat/context workflows.

#### Memory and Local RAG

- Memory layers: workspace-shared, agent-private, and session memory entries.
- Memory CRUD with lock/unlock and restore-as-new behavior.
- Memory operation audit events in timeline.
- Local RAG source management (enable/disable, include/exclude globs, indexing status).
- Unified memory/RAG query interface for retrieval use cases.

#### Skills and Tooling Platform

- Global skill discovery from `~/.agents/skills` (with compatibility fallback roots).
- Skill detail inspection (`SKILL.md`) in-app via typed IPC.
- Per-agent skill assignment modes: `global_only`, `global_plus_selected`, `selected_only`.
- Workspace tool registry with system/custom tool definitions and in-app CRUD editor.
- Custom script tool runtime loading with policy-aware action/category mapping.
- Disabled-tool enforcement across middleware and resume paths.
- Safe no-execution tool preview console.

#### File Mentions and Context Attachments

- Thread composer `@` mention search for workspace files with ranked suggestions and keyboard navigation.
- Mention selections materialize as attached file chips (Codex/Cursor-style) with remove and click-to-open actions.
- Attached files are passed as explicit `referencedFiles` metadata through renderer transport, preload, and main IPC.
- Main-process mention resolver supports inline `@path` tokens and explicit attachments together.
- Context injection is constrained by workspace confinement, traversal rejection, binary detection, per-file size caps, and total context truncation limits.
- Mention-derived file content is injected for the current invocation without mutating the visible user chat message text.

#### Prompt Repository and AGENTS Reuse

- Dedicated Prompts page for managing reusable markdown prompt assets.
- Supports both `AGENTS.md` and arbitrary `.md` prompts.
- Discovery overlay from `~/.agents/prompts` with precedence over app-global prompt assets.
- Managed prompt storage under `~/.openwork/prompts/global` and `~/.openwork/prompts/workspaces/<workspace-id>`.
- Per-workspace and per-agent prompt bindings with configurable materialization targets.
- Materialization targets include workspace root and `.agents/<agent-slug>/<file>.md`.
- Variable render preview with `{{var_name}}` substitution and built-in workspace/agent/date variables.
- Managed sync with hash-based conflict detection and explicit overwrite flow (no silent clobbering).
- Materialization history/audit trail persisted in DB (`prompt_materializations`).
- Prompt pack import/export in JSON or YAML with collision-safe slug handling.
- Home bootstrap suggestion to apply an `AGENTS.md` prompt when a workspace has none.

#### Connectors and MCP Surface

- Connector registry and MCP server registry CRUD with typed IPC.
- Connector and MCP bundle import/export with secret redaction and merge-safe import behavior.
- Connector permission mapping controls aligned with agent policy enforcement.
- Connector telemetry: 24h activity, error counts, recent event feed, rate-limit metadata.
- Connector test-event injection for trigger validation and workflow simulation.

#### ZeroClaw Integration

- Managed runtime installation, verification, upgrades, and version status tracking.
- Deployment CRUD for model/workspace/runtime/policy/env/gateway config.
- Runtime lifecycle controls (`start`, `stop`, `restart`) plus health polling.
- Per-deployment capability policy modes and effective capability resolution.
- Thread speaker mode for ZeroClaw with incremental streaming and robust transport parsing (SSE/NDJSON/JSON fallback).
- Stop/cancel propagation to runtime (`agent:cancel`) from renderer transport abort.
- ZeroClaw message persistence fallback for reload-safe thread history.
- Sessions/Agents/Home/Kanban visibility for ZeroClaw deployment and thread state.
- Invocation diagnostics: transport mode, token chunks, fallback usage, duration, retries, pairing recovery.
- Timeline deep-links from ZeroClaw events to focused deployment diagnostics.
- Diagnostics filters, auto-refresh, historical pagination, and per-deployment export (`JSON` and redacted bundle).
- Runtime version apply flow per deployment with auto-restart if running.

#### Harness Engineering

- First-class Harness page with run controls, run history/detail, findings review queue, experiment comparisons, and trace inspector.
- Local-first benchmark corpus in `harness/benchmarks` covering coding/research/automation tiers.
- Harness run persistence and analytics via dedicated DB tables (`harness_runs`, `harness_task_results`, `harness_findings`, `harness_experiment_runs`, etc.).
- Trace normalization/export pipeline with redaction for secrets and home path fragments.
- Parallelized trace analyzer workflow with finding/hypothesis generation and human-review state transitions.
- Experiment + ablation orchestration with promotion policy checks and explicit human promotion approval.
- Runtime hardening middleware for budget controls, loop detection, pre-completion checklist warnings, and stop-reason telemetry.
- Harness metrics and gate reporting surfaces for run health, safety/approval friction, and promotion diagnostics.
- CI observe-stage harness job plus nightly harness benchmark workflow with artifact upload.
- Novel extension contracts (N1-N7) stubbed behind feature flags (`HARNESS_N1_ENABLED` … `HARNESS_N7_ENABLED`).

#### Settings, Theme, and Operator UX

- Dedicated settings workspace for provider keys, default model, security defaults, and runtime storage path visibility.
- Persistent theme system with PRD-aligned palettes: `Default`, `Human`, `Orc`, `Undead`, `Night Elf`.
- Home/Kanban command-card quick actions for major operations.
- System-health signals covering scheduler heartbeat, provider key configuration, and runtime activity.

#### Open-Source Packaging and Quality Gates

- Starter pack directories with import-ready bundles and docs:
  `agent-packs/` and `template-packs/`.
- `.env.example` committed for safe local configuration bootstrap.
- Unit-test coverage for sample pack shape compatibility and major IPC/runtime flows.
- CI coverage for lint/typecheck/test/build across supported OS runners.

## Requirements

- Node.js `>=20.19.0` (see `.nvmrc`)
- npm 10+

## Quick Start

```bash
npm ci
npm run dev
```

Optional: copy `.env.example` to `.env` for local provider key/env overrides.

## Scripts

- `npm run dev`: Launch Electron in development mode
- `npm run start`: Preview built app
- `npm run lint`: Run ESLint
- `npm run typecheck`: Type-check main/preload and renderer
- `npm run build`: Type-check and build production output
- `npm run test`: Run unit tests (Vitest)
- `npm run test:unit`: Run unit tests once
- `npm run test:unit:watch`: Run unit tests in watch mode
- `npm run test:smoke`: Run Playwright smoke tests (requires build output)
- `npm run test:smoke:build`: Build then run smoke tests
- `npm run harness:run`: Run all harness suites from `harness/benchmarks`
- `npm run harness:run:suite -- --suite=<suite-key>`: Run a single harness suite
- `npm run harness:score:recompute`: List/recompute stored harness run summaries from `harness/.runs`
- `npm run harness:gate`: Evaluate harness gate mode (`HARNESS_GATE_MODE=observe|soft|hard`)

## Architecture

See `docs/architecture/README.md` for the current domain boundaries and implementation direction.

## Starter Packs

- Agent packs: `agent-packs/`
- Template packs: `template-packs/`

These folders contain import-ready bundle examples for the Agents and Templates views.
Bundle formats are additive and portable across workspaces.

## Contributing

See `CONTRIBUTING.md` for setup, workflow, and quality gates.

## License

MIT. See `LICENSE`.
