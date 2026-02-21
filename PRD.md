Below is a full PRD for an **open-source, local-first “personal AI enterprise”** built by **forking OpenWork** and extending it into a multi-agent “Jarvis” with orchestration, agent management, a ReactFlow-style topology view, per-agent chat, tool/connectors, and (optional) Warcraft-style theming.

I’m writing this as if you’re building an open-source project that is:

- **not a commercial SaaS**
- **runs primarily on your Mac**
- **supports remote access later (optional)**
- **prioritizes “it actually does things” over “it demos well”**

Where I cite: OpenWork positioning + feature set (desktop app, sessions, permissions, templates, skills manager) ([GitHub][4]), OpenClaw’s “local action + integrations” framing ([openclaw][5]), wc3ui capabilities ([TwStalker][6]).

---

## 1) Product overview

### 1.1 Product name (working)

**JarvisWork** (working name) — an OpenWork-based desktop command center for a **personal “agent org chart”**.

### 1.2 One-liner

A **desktop “AI enterprise”** where a primary orchestrator routes work to specialized agents (coding, research, writing, social, ops), each with its own tools, memory, permissions, and chat — all **local-first** and **open-source**.

### 1.3 Why fork OpenWork instead of scratch

Forking OpenWork is the fast path because it already gives you:

- a desktop app + local/remote modes (“host mode” + “client mode”) ([GitHub][4])
- sessions, streaming updates, permissions/approvals, templates, and a skills manager ([GitHub][4])
- alignment with an “agentic harness” (OpenCode ecosystem) designed to run workflows and tools across your machine ([GitHub][4])

**Scratch-build** is only worth it if you want a totally different runtime, storage model, or UI framework. For a hobby + OSS “Jarvis,” forking is the leverage move.

---

## 2) Goals and non-goals

### 2.1 Goals

1. **Multi-agent orchestration**: a “CEO/orchestrator” agent that assigns tasks to sub-agents, tracks progress, and composes results.
2. **Per-agent identity + capabilities**: each agent has a role, tool access, memory scope, and permission policy.
3. **Operator-grade safety**: destructive actions require approvals; tool access is permissioned; logs are auditable.
4. **Usable UI**: ChatGPT-style chat per agent + a ReactFlow topology view (org chart / dependency graph).
5. **Extensible tooling**: add connectors (APIs, services, MCP servers) and skills easily.
6. **Local-first**: runs offline where possible; secrets stored locally; minimal cloud dependency.

### 2.2 Non-goals (explicit)

- No “enterprise governance” checklists (SOC2, SSO, etc.) unless you want them later.
- No attempt to “compete with” commercial agent platforms.
- No fully autonomous “run wild on my computer” mode by default (opt-in only).

---

## 3) Target users and personas

### 3.1 Primary persona

**Power user / builder**: uses AI daily, wants a structured agent system to offload recurring work (coding, research, writing, posting, automation).

### 3.2 Secondary persona

**OSS tinkerer**: wants to fork, write custom agents/skills, and share templates.

---

## 4) Core concepts and mental model

### 4.1 Core objects

- **Workspace**: the user’s “organization.” Contains agents, sessions, memories, templates, connectors.
- **Agent**: a named worker with:
  - role + system prompt
  - tool permissions
  - memory config (what it can read/write)
  - model config (provider/model)

- **Orchestrator**: special agent that delegates and merges outputs.
- **Session**: a conversation/task execution timeline; can involve multiple agents.
- **Task / Plan / Todo**: structured plan objects created by orchestrator and agents; displayed as a timeline/kanban.
- **Tool**: capabilities exposed to agents (filesystem, shell, web, APIs, connectors).
- **Connector**: integration wrapper (e.g., X/Twitter, GitHub, email).
- **Template**: reusable workflow spec (prompt + tool policies + expected outputs).

### 4.2 Execution model (high level)

1. User asks something in a session.
2. Orchestrator produces a plan + delegates to sub-agents.
3. Each sub-agent runs with its own tool permissions and memory.
4. Results stream back; orchestrator composes final output.
5. Logs + artifacts saved; optionally turned into a template.

---

## 5) Product requirements (functional)

### 5.1 Agent management

**FR-1: Agent registry**

- Create/edit/delete agents.
- Agent fields:
  - name, avatar/icon
  - role description
  - system prompt
  - default model/provider
  - tool policy (allowlist/denylist + approval rules)
  - memory scope (private/shared)
  - tags (coding, research, marketing…)

**Acceptance criteria**

- Users can create an agent in <60 seconds and start chatting with it.
- Agents persist across restarts.
- Import/export agent definitions as JSON/YAML.

---

### 5.2 Orchestrator and delegation

**FR-2: Orchestrator routing**

- Orchestrator can:
  - create a plan (structured)
  - spawn sub-agent runs
  - request approvals when needed
  - merge outputs into a final response

- Delegation styles:
  - “single-shot”: ask sub-agent once
  - “iterative”: allow back-and-forth between orchestrator and sub-agent
  - “parallel”: launch multiple sub-agent tasks simultaneously

**Acceptance criteria**

- Orchestrator can delegate to ≥3 agents in parallel and produce a combined result.
- User can see which agent did what, with timestamps and artifacts.

---

### 5.3 Sessions and chat UI

OpenWork already has sessions + streaming updates ([GitHub][4]). Extend with:

**FR-3: Multi-agent session view**

- Session has:
  - chat thread (with agent attribution)
  - execution timeline (todos, tool calls, approvals)
  - artifacts panel (files, snippets, outputs)

- “Talk to” dropdown:
  - Orchestrator (default)
  - direct agent chat (bypass orchestrator)

**Acceptance criteria**

- A session can switch between “Orchestrator” chat and “Direct agent” chat without losing context.
- Tool calls show readable summaries + expandable raw logs.

---

### 5.4 ReactFlow topology view (agent org chart)

**FR-4: Agent graph**

- Visualize agents as nodes, with edges showing:
  - delegation pathways
  - shared memory access
  - shared tools/connectors

- Allow:
  - dragging layout
  - grouping (departments: Dev, Research, Content…)
  - saving layouts per workspace

- Clicking a node opens:
  - agent profile
  - quick chat
  - recent runs
  - permissions

**Acceptance criteria**

- Graph updates when agents are added/removed.
- “Run delegation test” shows edges lighting up as tasks run.

---

### 5.5 Permissions and approvals

OpenWork surfaces permission requests (allow once/always/deny) ([GitHub][4]). Extend into a policy system:

**FR-5: Policy engine**

- Policies apply per agent, per tool, per connector.
- Approval types:
  - Always allow
  - Ask every time
  - Allow within session
  - Deny

- Risk tiers:
  - Tier 0: read-only (safe)
  - Tier 1: write to workspace
  - Tier 2: execute commands / network calls
  - Tier 3: external posting (X), money movement (default deny)

**Acceptance criteria**

- User can configure “never auto-post” globally.
- Every destructive action has a human gate unless explicitly allowed.

---

### 5.6 Memory and knowledge (local-first)

Inspired by the “persistent memory files” pattern popularized in agent ecosystems ([Zero Approval][7]), but implemented in a cleaner way:

**FR-6: Memory layers**

- **Session memory**: short-lived context for the current run.
- **Agent private memory**: notes/preferences specific to an agent.
- **Shared workspace memory**: facts/knowledge all agents can reference.
- **RAG index** (optional): local embedding index over:
  - selected folders
  - notes
  - docs
  - prior outputs

**Acceptance criteria**

- User can toggle what folders are indexed.
- Memory writes are transparent (“Agent X wrote: …”) and revertible.

---

### 5.7 Templates and “productized workflows”

OpenWork includes templates stored locally ([GitHub][4]). Extend into sharable “workflow packs”:

**FR-7: Workflow templates**

- Template includes:
  - starter prompt(s)
  - agent selection + policies
  - required connectors
  - expected artifacts/outputs

- Template can be:
  - run manually
  - scheduled (optional)
  - triggered by events (optional)

**Acceptance criteria**

- Export template pack that another user can import and run.

---

### 5.8 Connectors (APIs + messaging + MCP)

OpenWork mentions alternate UIs (WhatsApp/Slack/Telegram bridges) ([GitHub][4]), and OpenClaw-style ecosystems heavily use messaging channels + many integrations ([openclaw][5]).

**FR-8: Connector framework**

- Connector types:
  - Messaging: Telegram, Slack, Discord (later WhatsApp)
  - Dev: GitHub issues/PR summaries
  - Social: X posting (explicit approval required)
  - Email: draft + send flow (send behind explicit confirm)
  - Webhooks: generic inbound triggers

- MCP support:
  - manage MCP servers
  - map MCP tools into agent tool registry

**Acceptance criteria**

- Add/remove connector without rebuilding the app.
- Connectors are permissioned per agent.

---

### 5.9 Observability (for humans)

**FR-9: Run logs and audit trail**

- Every run records:
  - agent(s)
  - plan/todos
  - tool calls
  - approvals
  - outputs/artifacts
  - duration + token usage (if available)

- UI views:
  - session timeline
  - agent activity feed
  - “what changed on disk” summary

**Acceptance criteria**

- User can answer: “What did the system do yesterday?” in <30 seconds.

---

## 6) UX / UI spec (screens)

### 6.1 Navigation structure

Left sidebar:

- Home
- Sessions
- Agents
- Graph (Topology)
- Templates
- Skills/Tools
- Connectors
- Memory
- Settings

### 6.2 Home dashboard

Widgets:

- “New session”
- Recent sessions
- Agent status (idle/running)
- Pending approvals
- Scheduled runs (if enabled)
- System health (local runtime ok)

### 6.3 Sessions

- Session list with tags + search
- Session detail:
  - chat
  - execution timeline
  - artifacts
  - approvals panel

### 6.4 Agents

- Agent cards (role, model, last run)
- Agent detail:
  - prompt + config
  - permissions matrix
  - memory scope
  - tools/connectors enabled
  - “Test run” buttons (sanity checks)

### 6.5 Graph (ReactFlow)

- Org chart + dependency edges
- Toolbar:
  - group by department
  - show tools edges
  - show memory edges
  - run simulation

### 6.6 Templates

- Template library
- “Create from session” wizard
- Import/export packs

### 6.7 Skills/Tools

- Installed skills
- MCP servers
- Tool registry (capabilities exposed)
- Tool test console (safe sandbox)

Implementation status (`openwork-jarvis`):

- [x] Installed skills + in-app skill detail review
- [x] MCP server visibility + connector surface summary
- [x] Selectable tool registry with full custom-tool CRUD/editor
- [x] Policy-aware runtime integration for custom script tools
- [x] Safe no-execution tool preview console
- [x] ZeroClaw managed runtime install/verify/upgrade controls
- [x] ZeroClaw deployment CRUD from app (name/workspace/model/policy)
- [x] ZeroClaw lifecycle controls (start/stop/restart) + health checks
- [x] ZeroClaw runtime events/log stream with persisted observability
- [x] Per-deployment capability policy modes (`global_only`, `global_plus_assigned`, `assigned_only`, `deny_all_except_assigned`)
- [x] Per-deployment skills/tools/connectors assignment + deny lists
- [x] ZeroClaw direct thread speaker with incremental token streaming
- [x] ZeroClaw deployment visibility in Agents workspace + Home command cards/runtime summary
- [x] ZeroClaw stream hardening (SSE/NDJSON delta parsing + abort cancellation to runtime)
- [x] ZeroClaw thread message persistence fallback via `thread_values` for reload-safe history
- [x] Sessions sidebar ZeroClaw badge + dedicated `ZeroClaw` filter mode
- [x] ZeroClaw control page chat diagnostics (recent invocation telemetry from timeline events)
- [x] ZeroClaw diagnostics rows support one-click open-thread navigation
- [x] ZeroClaw per-deployment invocation diagnostics JSON export
- [x] Thread timeline `zeroclaw:webhook` events deep-link into the focused ZeroClaw deployment diagnostics view
- [x] ZeroClaw diagnostics filters (transport/fallback/errors) with invocation-error event coverage
- [x] ZeroClaw control-page near-real-time diagnostics refresh loop with operator toggle
- [x] ZeroClaw runtime log history pagination (`Load older`) for deeper incident timeline review
- [x] ZeroClaw runtime upgrade controls exposed in deployment UI (select version + upgrade action)
- [x] ZeroClaw per-deployment runtime-version apply flow (running deployments auto-restart)
- [x] ZeroClaw diagnostics bundle export (deployment, health, doctor, invocations, runtime events) with secret redaction

### 6.8 Connectors

- OAuth/API key setup
- Permission mapping per agent
- Rate limits + logs

### 6.9 Memory

- Browse memory entries
- RAG index settings
- Revert/lock entries (“do not overwrite”)

### 6.10 Settings

- Model providers
- Security defaults
- Storage locations
- Theme selection (default + Warcraft-style)

---

## 7) Warcraft-style UI theming (optional but awesome)

### 7.1 Approach A (recommended): theme layer

Keep your core UI as standard React components, then add a theme pack:

- typography
- borders
- buttons
- panels
- hover/active states
- icon set

### 7.2 Approach B: integrate wc3ui components

wc3ui provides Warcraft III-like web components and themed variants (including multiple “races”) and a large control set ([TwStalker][6]).

PRD requirement:

- Theme toggle: Default / Human / Orc / Undead / Night Elf
- “Command card” style quick actions for templates/agents (fits perfectly with wc3ui’s command-card concept) ([TwStalker][6])

Acceptance criteria:

- Entire app usable without theme enabled.
- Theme does not break accessibility (contrast, keyboard nav).

---

## 8) System architecture

### 8.1 Forking strategy

1. Fork OpenWork.
2. Keep upstream mergeable:
   - isolate your changes under `packages/jarvis-*` (or similar)
   - avoid rewriting core unless necessary

3. Add new modules:
   - orchestrator runtime
   - agent registry + policies
   - graph UI
   - memory + indexing

OpenWork repo structure shows a monorepo with `packages/`, `packaging/`, and docs like `ARCHITECTURE.md` ([GitHub][4]).

### 8.2 Desktop stack choice

OpenWork’s build requirements mention Tauri + Rust toolchain and Tauri CLI ([GitHub][4]).

- **Recommendation**: keep Tauri for compatibility with the fork.
- You can still build your UI in React; Tauri is just the shell.

### 8.3 Runtime

- **Agent runtime**: OpenWork/OpenCode harness (existing).
- **Orchestrator layer**: new module that:
  - creates plans
  - spawns sub-agent runs
  - aggregates outputs

- **Tooling layer**:
  - filesystem/shell tools (already present in harness-style systems)
  - connector tools (new)
  - MCP tool bridge (new)

### 8.4 Storage (local-first)

- SQLite (recommended) for:
  - sessions
  - agent configs
  - policies
  - run logs

- Filesystem for:
  - artifacts
  - templates (exportable packs)
  - memory markdown (optional human-readable mirror)

### 8.5 Security model

- Secrets in OS keychain (macOS Keychain)
- Explicit permission gates for:
  - shell exec
  - writing outside workspace
  - network calls
  - posting to social

---

## 9) Agent suite (default roster)

Ship a “starter enterprise” similar to the screenshot concept, but practical.

### 9.1 Orchestrator (CEO)

- Responsibilities:
  - interpret request
  - choose agents
  - make plan
  - verify outputs

- Tools:
  - read-only access to workspace memory
  - can request sub-agent runs

### 9.2 Dev agents

- “Coder”: repo edits, refactors, implements
- “Reviewer”: static review + tests + risk checks

### 9.3 Research agents

- “Researcher”: web research + synthesis
- “Scout”: trend scanning + idea mining (optional)

### 9.4 Content agents

- “Writer”: drafts posts/docs
- “Editor”: tone + clarity + formatting

### 9.5 Social/marketing agents

- “Social manager”: drafts posts + schedules (posting always approval-gated)

### 9.6 Ops agent

- “Operator”: file organization, automation scripts, local workflows

Each agent ships with:

- role prompt
- recommended tools
- default policy set

---

## 10) Phased roadmap (buildable)

### Phase 0 — Fork + baseline running (1–2 sessions)

- Fork OpenWork
- Build + run locally
- Confirm sessions + permissions + templates + skills manager work ([GitHub][4])

**Deliverable**: “Fork boots + I can chat + run a workflow.”

---

### Phase 1 — Agent registry + per-agent chat

- Agent CRUD UI
- Per-agent chat routing
- Basic policy UI (allow/ask/deny)
- Persist agents in SQLite

**Deliverable**: “I can create 5 agents and talk to each.”

---

### Phase 2 — Orchestrator delegation + timeline

- Orchestrator planning + task breakdown
- Parallel sub-agent runs
- Timeline view for delegation graph events

**Deliverable**: “Orchestrator delegates to 3 agents and merges output.”

---

### Phase 3 — ReactFlow topology view

- Graph view (agents, tools, memory edges)
- Node inspector + quick chat
- Save layouts

**Deliverable**: “My personal agent org chart is interactive and reflects reality.”

---

### Phase 4 — Memory + local RAG (optional)

- Memory layers UI
- Local indexing over selected folders
- Retrieval tool exposed to agents

**Deliverable**: “Agents can cite my local knowledge safely.”

---

### Phase 5 — Connectors + MCP

- Connector framework + UI
- Start with Slack/Discord/Telegram (whichever easiest for you)
- MCP server manager

**Deliverable**: “Agents can act across apps with explicit permissions.”

---

### Phase 6 — Theming + Warcraft UI pack (optional)

- Theme system
- wc3ui integration or custom theme pack ([TwStalker][6])

**Deliverable**: “JarvisWork can look like a Blizzard command center.”

---

## 11) Engineering spec (key interfaces)

### 11.1 Agent definition (example schema)

- `id`
- `name`
- `role`
- `systemPrompt`
- `modelProvider`, `modelName`
- `tools`: allowlist
- `connectors`: allowlist
- `policy`: ruleset
- `memoryScope`: private/shared
- `createdAt`, `updatedAt`

### 11.2 Policy rules

- `resource`: tool/connector
- `action`: read/write/exec/post
- `scope`: global/session/workspace
- `decision`: allow/ask/deny
- `constraints`: path regex, domain allowlist, rate limit

### 11.3 Orchestrator contract

- Input: user request + session context
- Output:
  - plan (ordered tasks)
  - sub-agent assignments
  - completion criteria
  - final response + artifacts list

---

## 12) Open-source packaging

### 12.1 Repo hygiene

- CONTRIBUTING.md
- SECURITY.md (responsible disclosure)
- example `.env` (no secrets)
- “template packs” folder
- “agent packs” folder

Implementation status (`openwork-jarvis`):

- [x] `CONTRIBUTING.md` + `SECURITY.md` published
- [x] `.env.example` template committed with no secrets
- [x] `template-packs/` with import-ready starter bundle + docs
- [x] `agent-packs/` with import-ready starter bundle + docs

### 12.2 Distribution

- Release builds for macOS first
- Import/export:
  - agent packs
  - template packs
  - connector configs (excluding secrets)

---

## 13) Key risks and mitigations

1. **Agents do destructive stuff**
   - mitigate with default-deny + approvals + path scoping

2. **System becomes a spaghetti mess**
   - mitigate with strict schemas + plugin boundaries

3. **Memory becomes creepy / uncontrolled**
   - mitigate with transparent memory writes + review queue + revert

4. **Connector auth pain**
   - mitigate with “connector devkit” and good UI flows

---

## 14) What to build first (the “don’t overthink it” MVP)

If you want the fastest “Jarvis feeling”:

1. Agent registry
2. Orchestrator delegation to 2–3 agents
3. Timeline view showing delegation
4. Graph view (even basic)
5. One real connector (e.g., GitHub summaries or a simple “post draft” flow)

That gets you to “this is a personal AI enterprise” fast, without boiling the ocean.

---

[1]: https://chatgpt.com/c/68ba5f62-1860-8332-8c37-986d6399e269 "Internal agent builder market"
[2]: https://chatgpt.com/c/68bf8c45-2990-8326-9c8b-a74cae0d0586 "AI agent builder PRD"
[3]: https://chatgpt.com/c/959c6c3d-cfe2-44bb-bed1-140d7b33ffe8 "AI Product Ideas with LLMs"
[4]: https://github.com/different-ai/openwork "GitHub - different-ai/openwork: An open-source alternative to Claude Cowork, powered by opencode"
[5]: https://openclaw.my/ "openclaw - Your Personal AI "
[6]: https://mobile.twstalker.com/Vjeux?utm_source=chatgpt.com "vjeux ✪ @Vjeux - Twitter Profile | TwStalker"
[7]: https://zeroapproval.xyz/research/?utm_source=chatgpt.com "The Banality of Automated Evil -- Zero Approval"
