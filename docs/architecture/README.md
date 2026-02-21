# Openwork-Jarvis Architecture (Phase 0 Baseline)

This document defines the implementation baseline for the Openwork-Jarvis roadmap.

## Core Principles

1. Local-first runtime and storage.
2. Explicit approval gates for risky actions.
3. Typed IPC boundaries between renderer and main.
4. Auditable run history and reproducible state transitions.

## Runtime Layers

1. Electron shell and preload bridge:
   `/Users/gtomberlin/Documents/Code/openwork-jarvis/src/main/index.ts`,
   `/Users/gtomberlin/Documents/Code/openwork-jarvis/src/preload/index.ts`
2. Main-process domain services and IPC handlers:
   `/Users/gtomberlin/Documents/Code/openwork-jarvis/src/main`
3. Deepagents execution runtime:
   `/Users/gtomberlin/Documents/Code/openwork-jarvis/src/main/agent`
4. Renderer UI, state, and stream transport:
   `/Users/gtomberlin/Documents/Code/openwork-jarvis/src/renderer/src`

## Data and Migrations

- SQLite storage is managed by `sql.js`.
- Schema evolution is migration-driven via:
  `/Users/gtomberlin/Documents/Code/openwork-jarvis/src/main/db/migrations`
- `schema_migrations` tracks applied migrations.

## Current Domain Boundaries

1. `workspace`: workspace root linking and file observation.
2. `threads/sessions`: conversation lifecycle and metadata.
3. `agent runtime`: model selection, stream orchestration, HITL control.
4. `models`: provider keys and default model settings.

## Implemented Foundations

1. Agent registry and policy engine (workspace-scoped).
2. Orchestrator delegation contracts with persisted timeline events.
3. Graph topology view with persisted workspace layouts.
4. Memory layers and local retrieval index (RAG source/chunk indexing + search).
5. Connector + MCP registries (CRUD and UI management surfaces).
6. Workflow template library:
   create/edit/delete, pack import/export, "create from session" derivation,
   and a main-process run pipeline with connector gating + policy/memory seeding
   and timeline audit events; templates now also persist optional schedule metadata
   (enabled, RRULE, timezone) for future automation wiring, with shared schedule
   RRULE parsing/validation logic used by both renderer and main-process code,
   and schedule validation
   in both renderer and main-process IPC, plus main-process generated copyable
   automation draft payloads, renderer schedule RRULE presets, and one-click
   `::automation-update{...}` directive clipboard generation now built by
   a main-process directive endpoint with cwd resolution precedence:
   explicit cwd > run thread workspace > workspace root > workspace id fallback.
   Template surfaces now also show a timezone-aware "next run" preview for
   supported HOURLY/WEEKLY RRULE schedules. Workflow templates now also carry
   trigger metadata scaffolding (timeline/connector/webhook trigger definitions)
   persisted in storage and editable from the template authoring surface.
7. Trigger runtime foundation:
   timeline event persistence now evaluates enabled timeline triggers and
   emits deduped `template_trigger_match` timeline events for matched templates,
   creating an auditable queue signal for future auto-run execution wiring.
8. Template trigger authoring UX:
   trigger metadata is now authored via a structured row editor (typed trigger
   kind, event key, optional source key, optional text match, enabled flag)
   instead of raw JSON-only editing.
9. Trigger execution policy:
   triggers now support execution modes (`notify` default, `auto_run` opt-in).
   Auto-run currently applies only to timeline-event triggers and includes
   loop-prevention guardrails (template-internal timeline/tool events are
   excluded from trigger matching).
10. Trigger operations UX:
    the right-side timeline now supports a trigger-focused filter mode
    (`Trigger Matches`) and quick-open actions from trigger-related events
    to either open the matched template in the Templates view editor state
    or jump directly to the spawned run thread when available.
11. Multi-source trigger matching:
    template trigger runtime now evaluates `connector_event` triggers using
    connector-key inference from timeline tool activity and evaluates
    `webhook` triggers from webhook-like tool/payload signals, while
    preserving the auto-run guardrail so only `timeline_event` triggers
    can auto-run (non-timeline trigger matches remain notify-only).
12. External trigger ingestion:
    timeline IPC now exposes a typed `timeline:ingestTriggerEvent` entrypoint
    for connector/webhook systems to emit triggerable timeline events into
    a thread, normalized into timeline tool events that flow through the same
    template-trigger matcher + dedupe/audit pipeline.
13. Trigger simulation tooling:
    Templates view now includes an external trigger simulator panel (connector/webhook)
    plus template-card "Prime simulator" actions to quickly inject representative
    trigger events and validate match/run behavior from the UI.
14. Connector test-event tooling:
    Connectors view now includes per-connector "Send test event" actions with
    configurable target thread/event key/payload, backed by timeline trigger-ingest
    IPC, enabling rapid connector trigger smoke tests without agent runs.
15. Trigger diagnostics in timeline:
    right-panel timeline entries for `template_trigger_match` now expose
    parsed trigger metadata chips (type/event/source/mode/origin/status)
    to improve observability while validating trigger behavior.
16. Scheduled template runtime:
    app startup now initializes a persistent template scheduler loop that
    evaluates enabled template RRULE schedules and executes due runs using
    the existing template-run pipeline (connector gating, policy defaults,
    memory seeding) with timeline audit events for schedule claim/status.
17. Scheduled-run durability:
    a dedicated `template_schedule_runs` table now records per-template
    schedule occurrence attempts with unique `(template_id, scheduled_for)`
    dedupe semantics, run status (`pending|started|blocked|error`), optional
    run-thread linkage, and metadata/error payloads for restart-safe behavior.
18. Scheduler observability thread:
    each workspace has a deterministic system audit thread for scheduled
    workflow activity (`template:schedule` timeline events), including
    blocked/error outcomes and quick-linkable run-thread IDs for started runs.
19. Scheduled-run query surface:
    templates IPC/preload now exposes `templates:listScheduleRuns`, backed by
    workspace/template-filterable DB queries over `template_schedule_runs`.
20. Template + Home UX updates:
    the Templates library now renders latest scheduled-run status per template
    (started/blocked/error with connector/error details and run-thread shortcut),
    and the Home dashboard now includes quick-start/session health widgets plus
    schedule counts (enabled vs paused templates).
21. Skills/Tools workspace:
    renderer now includes a dedicated Skills/Tools view in navigation with
    MCP server status, connector surface summary, built-in tool registry and
    risk tiers, plus a safe no-execution tool-test preview console.
22. Settings workspace:
    renderer now includes a dedicated Settings view with provider/API-key
    management, default-model selection, and explicit security-default toggles
    (including "never auto-post" default guardrail surfaced in UI).
23. Connector permission mapping UX:
    connector access is now directly manageable from UI in two places:
    agent editor allowlist fields (tool + connector allowlists) and per-connector
    agent access toggles in Connectors view, aligned with runtime connector
    allowlist enforcement used by policy/runtime routing.
24. Sessions UX improvements:
    session sidebar now includes search + quick status filters (all/active/blocked)
    and compact status/tag chips for each session row to improve large-thread
    navigation and visibility.
25. Theme system toggle:
    settings now exposes persistent local theme selection
    (Default/Human/Orc/Undead/Night Elf) using CSS variable palettes applied via
    root `data-theme` attributes.
26. Workspace observability feed:
    timeline IPC now supports workspace-scoped event listing and Home now surfaces
    recent workspace activity plus a 24h disk-change summary derived from write/edit
    tool call events.
27. Default agent roster seeding:
    fresh workspaces now auto-seed a PRD-aligned baseline roster on first boot
    (Orchestrator, Coder, Reviewer, Researcher, Writer, Editor, Social Manager,
    Operator) via a centralized default-agent-pack service.
28. Persisted global security defaults:
    settings now persists `requireExecApproval`, `requireNetworkApproval`, and
    `denySocialPosting` in local config storage, exposed through typed settings
    IPC/preload APIs and consumed by runtime policy resolution.
29. Runtime security-default enforcement:
    policy decision resolution now applies global safety overrides so connector/
    network posting can be hard-denied, and explicit allow rules for risky exec/
    network actions are downgraded to approval-gated behavior when defaults
    require operator confirmation.
30. Memory transparency and auditability:
    memory create/delete/lock/unlock operations now emit timeline audit events
    (thread-local when available, otherwise workspace memory-audit system thread),
    while locked entries are non-destructive and restorable via "restore as new"
    in the Memory view.
31. Settings observability upgrades:
    Settings now includes resolved local storage path inspection (openwork dir,
    primary/checkpoint DB paths, thread checkpoint directory, env file) with
    one-click path copy utilities for operator debugging.
32. Connector operations telemetry:
    Connectors view now surfaces per-connector 24h activity/error counts,
    recent connector event logs, and configurable `rateLimitPerHour` metadata
    (with over-limit highlighting) to satisfy operator-facing "rate limits + logs"
    requirements.
33. Home command-card actions:
    Home now includes Warcraft-inspired quick command cards for primary ops
    routes (Templates, Agents, Connectors, Skills, Memory) to reduce navigation
    friction for high-frequency workflows.
34. Agent pack format support:
    Agent registry import/export now supports both JSON and YAML clipboard
    payloads, with auto-detection on import for PRD-aligned portable agent
    definitions.
35. Home system-health widget:
    Home now includes an explicit local runtime health card with workspace
    activity signal, scheduler heartbeat signal, and configured provider-key
    count to satisfy PRD system-health visibility.
36. Agent operations observability and test actions:
    Agents view now surfaces per-agent last-activity and recent run event
    history sourced from timeline events, and provides direct-chat plus
    one-click sanity test session actions wired through speaker metadata.
37. Template pack format support:
    Template import/export UI now supports both JSON and YAML formats with
    selectable export format and import auto-detection fallback.
38. Graph department grouping:
    Graph toolbar now supports a dedicated "Group by Dept" layout mode that
    clusters specialists by primary tag/department while keeping orchestrator
    central, alongside existing tool/memory edge toggles and delegation
    simulation controls.
39. Connector pack import/export hardening:
    connectors IPC now exposes typed `connectors:exportBundle` and
    `connectors:importBundle` workflows for portable connector+MCP packs,
    with default secret redaction (`token|secret|password|apiKey` key patterns)
    and import-time preservation of previously stored secrets when redacted
    placeholders are encountered.
40. Skills registry and per-agent skill policy:
    a dedicated skills registry now discovers global skills from
    `~/.agents/skills` (plus compatibility fallback), exposes typed
    `skills:list` and `skills:getDetail` IPC for in-app inspection of
    `SKILL.md`, and adds per-agent skill assignment controls
    (`global_only`, `global_plus_selected`, `selected_only`) persisted in
    agent storage and injected into runtime context through skill-aware
    prompts + a gated `read_skill` tool.
41. Tool registry management and custom runtime tools:
    the app now persists a first-class workspace tool registry (`tools` table),
    exposes typed `tools:list|get|create|update|delete` IPC/preload APIs, seeds
    default system tools on boot, renders a selectable in-app tool editor with
    custom-tool CRUD and system enable/disable controls, and loads enabled custom
    `script` tools into runtime with policy-aware action/category mapping plus
    disabled-tool enforcement during middleware and interrupt resume flows.
42. ZeroClaw threaded chat speaker support:
    thread speaker selection now supports ZeroClaw deployments, with main-process
    invoke routing that manages runtime readiness, pairing/token auth, and
    incremental token forwarding into existing thread stream channels.
43. ZeroClaw visibility in core operator surfaces:
    Agents view now includes a dedicated deployed-ZeroClaw roster with runtime
    status, health summary, start/stop/restart controls, and one-click direct
    ZeroClaw chat threads; Home/Kanban also surfaces ZeroClaw runtime counts and
    a command card shortcut to the ZeroClaw deployment control page.
44. ZeroClaw stream reliability hardening:
    webhook parsing now supports event/data framed SSE token streams, NDJSON
    nested token payloads, and improved done/error event normalization to
    prevent dropped incremental chunks.
45. ZeroClaw cancellation and chat history durability:
    renderer transport aborts now invoke typed runtime cancellation (`agent:cancel`)
    so stopping streams halts backend execution, and ZeroClaw chat messages are
    persisted into thread `thread_values` with renderer fallback loading so
    ZeroClaw-only threads survive reloads without LangGraph checkpoints.
46. ZeroClaw invocation diagnostics telemetry:
    ZeroClaw webhook invocations now emit structured stream diagnostics
    (transport mode, token chunk count, synthetic fallback usage, duration,
    attempt count, and pairing recovery) into timeline payloads for
    observability and operator triage.
47. Sessions + control-surface ZeroClaw UX:
    Sessions sidebar now exposes an explicit `ZeroClaw` filter and thread
    badges based on speaker metadata, while ZeroClaw control view includes
    a recent chat invocation diagnostics panel derived from workspace timeline
    events scoped to the selected deployment.
48. ZeroClaw diagnostics operator actions:
    invocation diagnostics now include one-click thread jump actions for fast
    incident/context pivoting, plus per-deployment JSON export of diagnostics
    summaries and raw invocation records for offline triage/support workflows.
49. ZeroClaw timeline-to-diagnostics deep-linking and filter controls:
    thread timeline `zeroclaw:webhook` invocation/error events now expose
    direct-open actions that focus the corresponding deployment in ZeroClaw
    view, and diagnostics add transport/fallback/error filters with explicit
    webhook error-event parsing for faster stream failure triage.
50. ZeroClaw diagnostics live refresh and historical pagination:
    ZeroClaw control view now supports timed near-real-time diagnostics refresh
    (operator-toggleable) with last-refresh visibility, and runtime event logs
    provide cursor-based "Load older" pagination for deeper historical triage.
51. Open-source starter pack assets:
    repository now includes documented `agent-packs/` and `template-packs/`
    directories with import-ready starter bundles and schema-smoke tests to
    keep sample pack artifacts valid as import contracts evolve.
52. ZeroClaw operator upgrade and bundle diagnostics export:
    ZeroClaw control view now surfaces managed runtime version selection with
    explicit upgrade action and per-deployment runtime apply/restart flow, plus
    export of a redacted diagnostics bundle
    (install/runtime state, deployment snapshot, doctor report, invocation
    telemetry, and runtime events) for support and incident handoff.
