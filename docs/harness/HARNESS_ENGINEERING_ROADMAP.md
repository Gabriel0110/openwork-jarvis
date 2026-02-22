# Harness Engineering Roadmap (Openwork-Atlas)

Last updated: 2026-02-22

## Objectives

- Maximize real-world task reliability for high-entropy coding/research/automation workflows.
- Reduce regressions by making every runtime/prompt/tool change harness-measurable.
- Build a closed-loop system where traces automatically produce the next best experiments.
- Keep human review in the loop for high-impact harness/prompt/policy changes.

## External Inputs Reviewed

- LangChain: improving deep agents with harness engineering (trace analyzer workflow, parallel trace diagnosis, experiment loops).
- OpenAI: harness engineering principles (legible harnesses, robust deltas over benchmark-only wins, high-entropy task realism).

## Current State Snapshot (what we already have)

Strengths already in repo:

- Strong runtime control + observability foundations:
  - timeline ingestion and event classes (`subagent_started`, `subagent_completed`, `approval_required`, tool events)
  - stream transport and custom event handling
- Approval and policy scaffolding:
  - policy resolution + constraint/rate-limit/session grants
  - HITL review flow with approve/reject/edit paths
- Deep-agent primitives are in use:
  - subagent delegation
  - todos
  - filesystem and custom tool surfaces
- Test baseline exists:
  - unit tests across policy, timeline, template triggers, skills/tools, zeroclaw IPC
  - smoke launch test

Key gaps vs harness-engineering best practices:

- No first-class benchmark corpus with difficulty tiers and acceptance specs.
- No automated trace diagnosis loop that turns failures into structured hypotheses.
- No experiment registry / ablation runner / merge gate logic.
- No explicit reliability SLO dashboard (pass rate, tool error rate, approval friction, time-to-complete, cost).
- No canary/shadow evaluation for prompt/model/tool policy changes.

## Mandatory Workstreams

## W1. Benchmark Corpus + Scoring Harness

Goal: define what “better” means with representative tasks, not just anecdotal success.

Tasks:

- Create benchmark schema and corpus:
  - add `harness/benchmarks/*.yaml` with: task prompt, workspace fixture, expected artifacts, scoring rubric, max steps/tokens/time, risk class.
- Add benchmark runner service:
  - `src/main/harness/benchmark-runner.ts`
  - deterministic execution options (seed/model/profile), budget limits, artifact capture.
- Add scoring engine:
  - `src/main/harness/scoring.ts`
  - per-task score dimensions: correctness, completeness, safety compliance, efficiency, tool hygiene.
- Persist benchmark runs:
  - DB migration + tables:
    - `harness_runs`
    - `harness_task_results`
    - `harness_artifacts`
- Add CLI entry:
  - `npm run harness:run -- --suite core-coding --profile default`

Acceptance:

- Re-runnable suite with stable result records and diffable scorecards.

## W2. Trace Capture Normalization Layer

Goal: make every run diagnosable with consistent structure.

Tasks:

- Build normalized trace model:
  - `src/main/harness/trace-types.ts`
  - include run/thread/session IDs, tool call lineage, approval nodes, subagent tree, token/cost/time stats.
- Add trace export assembler:
  - `src/main/harness/trace-export.ts`
  - gather from timeline + stream + runtime logs into a single JSON trace.
- Add redaction pass:
  - `src/main/harness/redaction.ts`
  - scrub secrets/tokens/path-sensitive fields for safe review and pack sharing.

Acceptance:

- One command exports reproducible, redacted traces for any run.

## W3. Trace Analyzer (Parallel Subagents)

Goal: automate failure diagnosis and hypothesis generation.

Tasks:

- Implement analyzer pipeline:
  - `src/main/harness/trace-analyzer.ts`
  - stages: fetch traces -> batch -> parallel subagent diagnosis -> synthesis.
- Add analyzer “skills” prompts/templates:
  - `harness/analyzers/prompts/*.md`
  - failure taxonomy, root-cause tags, suggested interventions.
- Add result persistence:
  - DB tables:
    - `harness_findings`
    - `harness_hypotheses`
- Add review gate:
  - findings must be human-approved before changes are queued for experiments.

Acceptance:

- For a failed suite, analyzer emits grouped root causes + ranked interventions.

## W4. Experiment + Ablation Engine

Goal: controlled change management with measurable deltas.

Tasks:

- Define intervention types:
  - prompt patch, middleware toggle, tool policy change, model routing change, budget adjustment.
- Build experiment spec:
  - `harness/experiments/*.yaml` with baseline/control, candidate variants, target suites.
- Implement runner:
  - `src/main/harness/experiment-runner.ts`
  - executes baseline vs variants, computes significance/robustness checks.
- Add promotion rules:
  - require net positive on primary metrics + no safety regression.

Acceptance:

- Harness can run A/B/N experiments and generate merge recommendation reports.

## W5. Runtime Harness Hardening in Agent Loop

Goal: enforce quality invariants during execution, not only offline.

Tasks:

- Add pre-completion checklist middleware:
  - verify task objectives met, artifacts present, unresolved todos zero or justified.
- Add loop/degeneracy detector:
  - detect repetitive tool call patterns, empty-progress cycles, escalating retries.
- Add adaptive budget controller:
  - token/time/tool-call ceilings by task class and confidence.
- Add explicit stop-reason codes:
  - `completed`, `budget_exhausted`, `blocked_on_approval`, `tool_failure`, `policy_denied`, etc.

Likely files:

- `src/main/agent/runtime.ts` (middleware insertion points)
- new middleware modules under `src/main/agent/middleware/`

Acceptance:

- Reduced runaway loops and improved completion quality on long tasks.

## W6. Safety + Approval Quality Metrics

Goal: optimize HITL quality, not just count approvals.

Tasks:

- Add approval telemetry dimensions:
  - approval latency
  - reject/edit ratio
  - post-approval success/failure outcomes
  - tool risk tier distribution
- Add blocked-run diagnostics:
  - “why blocked”, “what could unblock safely”.
- Add policy false-positive/false-negative review queue:
  - identify over-restrictive rules or unsafe gaps.

Acceptance:

- Quantified approval friction and targeted policy tuning recommendations.

## W7. Harness UX Surface (Operator Console)

Goal: first-class visibility and control for harness operations.

Tasks:

- Add `Harness` page in renderer:
  - suite run controls
  - run history + score trends
  - finding/hypothesis review queue
  - experiment comparison views
- Add drill-down panels:
  - trace graph, tool-call timeline, subagent tree, approval path.

Likely files:

- `src/renderer/src/components/harness/*`
- sidebar route/store wiring in `src/renderer/src/lib/store.ts` and app routing.

Acceptance:

- Operator can run, inspect, and approve harness-driven improvements without terminal usage.

## W8. CI + Merge Gates

Goal: prevent regressions from reaching mainline.

Tasks:

- Add CI suite for harness smoke + key benchmark subset.
- Add optional nightly full benchmark run.
- Fail merge when:
  - primary reliability drops beyond threshold
  - safety regressions detected
  - cost/latency exceed allowed envelope without approved exception.

Acceptance:

- Harness metrics become a release gate, not a dashboard-only metric.

## High-Impact Novel Extensions

## N1. Failure Fingerprinting + Clustering

- Embed failure traces and cluster by latent pattern.
- Prioritize interventions by cluster blast radius and recurrence.

## N2. Counterfactual Replay

- Re-run failed traces with one variable changed (prompt/tool policy/model) to isolate causal impact.

## N3. Dynamic Subagent Portfolio Router

- Route subagent type/model based on early uncertainty signals and task decomposition quality.

## N4. Policy Simulation Sandbox

- Offline replay of historical traces under candidate policy sets to quantify approval-load and safety tradeoffs before rollout.

## N5. Confidence-Calibrated Completion

- Add a calibrated confidence model at completion time; low-confidence results auto-trigger verifier subagent.

## N6. Cost-Quality Frontier Optimizer

- Learn which model/tool profile gives best reliability per dollar per task class.

## N7. Harness Memory (Meta-Learning)

- Persist “what fixed what” mappings so new failures can retrieve historically successful interventions.

## Prioritized Execution Order

1. W1 benchmark corpus + scoring
2. W2 normalized traces
3. W3 trace analyzer
4. W4 experiment/ablation engine
5. W5 runtime hardening middleware
6. W6 approval quality metrics
7. W7 harness UI
8. W8 CI merge gates
9. Novel extensions N1-N7 incrementally after baseline loop is stable

## Definition of Done (Harness Program)

- Benchmark suites cover top real-world workflows and run reproducibly.
- Trace analyzer produces actionable, human-reviewable hypotheses from failed runs.
- Experiment engine can prove robust improvements before promotion.
- Runtime includes loop prevention, completion checks, and budget governance.
- CI enforces reliability/safety regression gates.
- Harness dashboard enables operational ownership without ad-hoc scripts.
