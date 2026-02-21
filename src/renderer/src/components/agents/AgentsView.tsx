import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Bot,
  ChevronDown,
  Download,
  MessageSquare,
  Plus,
  Save,
  Trash2,
  Upload,
  UserRound
} from "lucide-react"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Badge } from "@/components/ui/badge"
import { useAppStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import type {
  AgentSkillMode,
  PolicyDecision,
  PolicyRule,
  PolicyScope,
  SkillDefinition,
  TimelineEvent,
  ZeroClawDeploymentState
} from "@/types"
import {
  POLICY_PRESETS,
  TOOL_POLICY_ROWS,
  constraintDraftToPolicy,
  policyToConstraintDraft,
  type PolicyConstraintDraft,
  type PolicyPresetId
} from "./policy-utils"

interface AgentFormState {
  name: string
  role: string
  systemPrompt: string
  modelProvider: "anthropic" | "openai" | "google" | "ollama"
  modelName: string
  memoryScope: "private" | "shared"
  skillMode: AgentSkillMode
  toolAllowlist: string
  connectorAllowlist: string
  skillsAllowlist: string[]
  tags: string
  isOrchestrator: boolean
}

function defaultFormState(): AgentFormState {
  return {
    name: "",
    role: "",
    systemPrompt: "",
    modelProvider: "anthropic",
    modelName: "claude-sonnet-4-5-20250929",
    memoryScope: "private",
    skillMode: "global_only",
    toolAllowlist: "",
    connectorAllowlist: "",
    skillsAllowlist: [],
    tags: "",
    isOrchestrator: false
  }
}

function parseCsvAllowlist(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    )
  )
}

interface PolicyMatrixRow {
  resourceType: "tool" | "filesystem" | "network" | "connector"
  resourceKey: string
  action: "read" | "write" | "exec" | "post"
  label: string
  riskTier: "tier0" | "tier1" | "tier2"
  displayKey: string
}

const TOOL_POLICY_MATRIX_ROWS: PolicyMatrixRow[] = TOOL_POLICY_ROWS.map((row) => ({
  resourceType: "tool",
  resourceKey: row.tool,
  action: row.action,
  label: row.label,
  riskTier: row.riskTier,
  displayKey: row.tool
}))

function toEventTimestamp(value: Date | string | number | undefined): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function formatRelativeTime(timestampMs: number | null, nowMs: number): string {
  if (!timestampMs) return "No activity"
  const deltaMs = Math.max(0, nowMs - timestampMs)
  const minutes = Math.floor(deltaMs / (60 * 1000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getPolicyRowKey(row: {
  resourceType: string
  resourceKey: string
  action: string
}): string {
  return `${row.resourceType}:${row.resourceKey}:${row.action}`
}

// Collapsible section component
function CollapsibleSection({
  title,
  defaultOpen = false,
  children
}: {
  title: string
  defaultOpen?: boolean
  children: React.ReactNode
}): React.JSX.Element {
  const [isOpen, setIsOpen] = useState(defaultOpen)

  return (
    <div className="rounded-lg border border-border/40">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="flex w-full items-center justify-between px-4 py-3 text-left transition-colors hover:bg-background-interactive"
      >
        <span className="text-xs font-medium text-muted-foreground">{title}</span>
        <ChevronDown
          className={cn(
            "size-4 text-muted-foreground transition-transform",
            isOpen && "rotate-180"
          )}
        />
      </button>
      {isOpen && <div className="border-t border-border/30 px-4 py-4">{children}</div>}
    </div>
  )
}

export function AgentsView(): React.JSX.Element {
  const {
    agents,
    models,
    providers,
    createThread,
    loadAgents,
    createAgent,
    updateAgent,
    deleteAgent,
    loadModels,
    loadProviders,
    setShowZeroClawView
  } = useAppStore()

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [form, setForm] = useState<AgentFormState>(defaultFormState)
  const [isSaving, setIsSaving] = useState(false)
  const [policies, setPolicies] = useState<PolicyRule[]>([])
  const [isPolicySaving, setIsPolicySaving] = useState(false)
  const [, setPolicyConstraintDrafts] = useState<Record<string, PolicyConstraintDraft>>({})
  const [policyUiError, setPolicyUiError] = useState<string | null>(null)
  const [policyScope, setPolicyScope] =
    useState<Extract<PolicyScope, "workspace" | "global">>("workspace")
  const [agentBundleStatus, setAgentBundleStatus] = useState<string | null>(null)
  const [isBundleBusy, setIsBundleBusy] = useState(false)
  const [activityEvents, setActivityEvents] = useState<TimelineEvent[]>([])
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now())
  const [availableSkills, setAvailableSkills] = useState<SkillDefinition[]>([])
  const [zeroClawDeployments, setZeroClawDeployments] = useState<ZeroClawDeploymentState[]>([])

  const workspaceId = useMemo(() => agents[0]?.workspaceId || "default-workspace", [agents])

  const loadZeroClawDeployments = useCallback(async (): Promise<void> => {
    try {
      const deployments = await window.api.zeroclaw.deployment.list(workspaceId)
      setZeroClawDeployments(deployments)
    } catch (error) {
      console.warn("[AgentsView] Failed to load ZeroClaw deployments.", error)
    }
  }, [workspaceId])

  useEffect(() => {
    loadAgents()
    loadModels()
    loadProviders()
    void Promise.all([window.api.skills.list(), loadZeroClawDeployments()])
      .then(([result]) => {
        setAvailableSkills(result.skills)
      })
      .catch((error) => {
        console.warn("[AgentsView] Failed to load skills.", error)
      })
  }, [loadAgents, loadModels, loadProviders, loadZeroClawDeployments])

  useEffect(() => {
    const timer = setInterval(() => {
      void loadZeroClawDeployments()
    }, 12_000)
    return () => clearInterval(timer)
  }, [loadZeroClawDeployments])

  useEffect(() => {
    const timer = setInterval(() => {
      setCurrentTimeMs(Date.now())
    }, 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false

    const loadActivity = async (): Promise<void> => {
      try {
        const events = await window.api.timeline.listWorkspace(workspaceId, 400)
        if (!cancelled) setActivityEvents(events)
      } catch (error) {
        console.warn("[AgentsView] Failed to load activity.", error)
      }
    }

    void loadActivity()
    const timer = setInterval(() => {
      void loadActivity()
    }, 12_000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [workspaceId])

  useEffect(() => {
    if (!selectedAgentId && agents.length > 0) {
      setSelectedAgentId(agents[0].id)
    }
  }, [agents, selectedAgentId])

  const selectedAgent = useMemo(
    () => agents.find((agent) => agent.id === selectedAgentId) || null,
    [agents, selectedAgentId]
  )

  const activityByAgentId = useMemo(() => {
    const map = new Map<string, { lastActiveAt: number | null }>()
    const sorted = [...activityEvents].sort(
      (left, right) => toEventTimestamp(right.occurredAt) - toEventTimestamp(left.occurredAt)
    )
    for (const event of sorted) {
      const ids = new Set<string>()
      if (event.sourceAgentId) ids.add(event.sourceAgentId)
      if (event.targetAgentId) ids.add(event.targetAgentId)
      for (const agentId of ids) {
        const entry = map.get(agentId) || { lastActiveAt: null }
        const occurredAt = toEventTimestamp(event.occurredAt)
        if (!entry.lastActiveAt || occurredAt > entry.lastActiveAt) {
          entry.lastActiveAt = occurredAt
        }
        map.set(agentId, entry)
      }
    }
    return map
  }, [activityEvents])

  const zeroClawRunningCount = useMemo(
    () =>
      zeroClawDeployments.filter((d) => d.status === "running" || d.status === "starting").length,
    [zeroClawDeployments]
  )

  useEffect(() => {
    if (!selectedAgent) {
      setForm(defaultFormState())
      return
    }
    setForm({
      name: selectedAgent.name,
      role: selectedAgent.role,
      systemPrompt: selectedAgent.systemPrompt,
      modelProvider: selectedAgent.modelProvider,
      modelName: selectedAgent.modelName,
      memoryScope: selectedAgent.memoryScope,
      skillMode: selectedAgent.skillMode,
      toolAllowlist: selectedAgent.toolAllowlist.join(", "),
      connectorAllowlist: selectedAgent.connectorAllowlist.join(", "),
      skillsAllowlist: [...selectedAgent.skillsAllowlist],
      tags: selectedAgent.tags.join(", "),
      isOrchestrator: selectedAgent.isOrchestrator
    })
  }, [selectedAgent])

  useEffect(() => {
    async function loadPolicies(): Promise<void> {
      if (!selectedAgentId) {
        setPolicies([])
        setPolicyConstraintDrafts({})
        return
      }
      const loaded = await window.api.policies.list(selectedAgentId)
      setPolicies(loaded)
      const nextDrafts: Record<string, PolicyConstraintDraft> = {}
      for (const row of TOOL_POLICY_MATRIX_ROWS) {
        const explicit = loaded.find(
          (p) =>
            p.resourceType === row.resourceType &&
            p.resourceKey === row.resourceKey &&
            p.action === row.action &&
            p.scope === policyScope
        )
        nextDrafts[getPolicyRowKey(row)] = policyToConstraintDraft(explicit)
      }
      setPolicyConstraintDrafts(nextDrafts)
    }
    loadPolicies()
  }, [selectedAgentId, policyScope])

  const providerOptions = providers.length
    ? providers.map((provider) => provider.id)
    : (["anthropic", "openai", "google"] as const)
  const modelOptions = models.filter((model) => model.provider === form.modelProvider)

  async function handleCreateAgent(): Promise<void> {
    const fallbackModel = modelOptions[0]?.model || "claude-sonnet-4-5-20250929"
    const created = await createAgent({
      name: "New Agent",
      role: "Specialist",
      systemPrompt: "You are a specialist agent.",
      modelProvider: form.modelProvider,
      modelName: fallbackModel,
      memoryScope: "private",
      skillMode: "global_only",
      skillsAllowlist: [],
      tags: []
    })
    setSelectedAgentId(created.id)
  }

  async function handleSave(): Promise<void> {
    if (!selectedAgentId) return
    setIsSaving(true)
    try {
      await updateAgent(selectedAgentId, {
        name: form.name,
        role: form.role,
        systemPrompt: form.systemPrompt,
        modelProvider: form.modelProvider,
        modelName: form.modelName,
        memoryScope: form.memoryScope,
        skillMode: form.skillMode,
        skillsAllowlist: form.skillsAllowlist,
        toolAllowlist: parseCsvAllowlist(form.toolAllowlist),
        connectorAllowlist: parseCsvAllowlist(form.connectorAllowlist),
        tags: form.tags
          .split(",")
          .map((t) => t.trim())
          .filter(Boolean),
        isOrchestrator: form.isOrchestrator
      })
    } finally {
      setIsSaving(false)
    }
  }

  async function handleDelete(): Promise<void> {
    if (!selectedAgentId) return
    await deleteAgent(selectedAgentId)
    setSelectedAgentId((prev) => (prev === selectedAgentId ? null : prev))
  }

  async function handleOpenDirectChat(): Promise<void> {
    if (!selectedAgent) return
    await createThread({
      title: `${selectedAgent.name} Session`,
      workspaceId,
      speakerType: "agent",
      speakerAgentId: selectedAgent.id
    })
  }

  async function handleExportBundle(format: "json" | "yaml" = "json"): Promise<void> {
    setIsBundleBusy(true)
    setAgentBundleStatus(null)
    try {
      const bundle = await window.api.agents.exportBundle()
      const serialized = format === "yaml" ? stringifyYaml(bundle) : JSON.stringify(bundle, null, 2)
      await navigator.clipboard.writeText(serialized)
      setAgentBundleStatus(`Exported ${bundle.items.length} agents to clipboard.`)
    } catch (error) {
      setAgentBundleStatus(error instanceof Error ? error.message : "Failed to export.")
    } finally {
      setIsBundleBusy(false)
    }
  }

  async function handleImportBundle(): Promise<void> {
    const input = window.prompt("Paste exported agent bundle (JSON or YAML):")
    if (!input?.trim()) return

    setIsBundleBusy(true)
    setAgentBundleStatus(null)
    try {
      let parsed: unknown
      try {
        parsed = JSON.parse(input)
      } catch {
        parsed = parseYaml(input)
      }
      const imported = await window.api.agents.importBundle(
        parsed as Parameters<typeof window.api.agents.importBundle>[0]
      )
      await loadAgents()
      if (imported.length > 0) setSelectedAgentId(imported[0].id)
      setAgentBundleStatus(`Imported ${imported.length} agents.`)
    } catch (error) {
      setAgentBundleStatus(error instanceof Error ? error.message : "Failed to import.")
    } finally {
      setIsBundleBusy(false)
    }
  }

  function toggleSkillAllowlist(skillName: string): void {
    const normalized = skillName.trim()
    if (!normalized) return
    setForm((prev) => {
      const current = new Set(prev.skillsAllowlist.map((i) => i.trim()).filter(Boolean))
      if (current.has(normalized)) {
        current.delete(normalized)
      } else {
        current.add(normalized)
      }
      return { ...prev, skillsAllowlist: Array.from(current).sort() }
    })
  }

  async function upsertPoliciesBulk(
    entries: Array<{
      resourceType: "tool"
      resourceKey: string
      action: "read" | "write" | "exec" | "post"
      decision: PolicyDecision
      constraintDraft: PolicyConstraintDraft
    }>
  ): Promise<void> {
    if (!selectedAgentId || entries.length === 0) return
    setIsPolicySaving(true)
    setPolicyUiError(null)
    try {
      const updates = await Promise.all(
        entries.map(async (entry) => {
          const existing = policies.find(
            (p) =>
              p.resourceType === entry.resourceType &&
              p.resourceKey === entry.resourceKey &&
              p.action === entry.action &&
              p.scope === policyScope
          )
          const updated = await window.api.policies.upsert({
            policyId: existing?.id,
            agentId: selectedAgentId,
            resourceType: entry.resourceType,
            resourceKey: entry.resourceKey,
            action: entry.action,
            scope: policyScope,
            decision: entry.decision,
            constraints: constraintDraftToPolicy(entry.constraintDraft)
          })
          return { updated, key: getPolicyRowKey(entry), draft: entry.constraintDraft }
        })
      )
      setPolicies((prev) => {
        let next = [...prev]
        for (const { updated } of updates) {
          const index = next.findIndex((p) => p.id === updated.id)
          if (index >= 0) next[index] = updated
          else next = [updated, ...next]
        }
        return next
      })
      setPolicyConstraintDrafts((prev) => {
        const next = { ...prev }
        for (const { key, draft } of updates) next[key] = draft
        return next
      })
    } catch (error) {
      setPolicyUiError(error instanceof Error ? error.message : "Failed to save policies.")
    } finally {
      setIsPolicySaving(false)
    }
  }

  async function applyPolicyPreset(presetId: PolicyPresetId): Promise<void> {
    const preset = POLICY_PRESETS.find((p) => p.id === presetId)
    if (!preset) return
    const entries = TOOL_POLICY_MATRIX_ROWS.map((row) => {
      const rule = preset.byAction[row.action]
      return {
        resourceType: row.resourceType as "tool",
        resourceKey: row.resourceKey,
        action: row.action,
        decision: rule.decision,
        constraintDraft: { ...rule.constraints }
      }
    })
    await upsertPoliciesBulk(entries)
  }

  return (
    <div className="flex h-full min-h-0 flex-1 bg-background">
      {/* Sidebar - Agent List */}
      <aside className="flex w-64 flex-col border-r border-border/50 bg-sidebar/50">
        <div className="flex items-center justify-between border-b border-border/30 px-4 py-3">
          <span className="text-xs font-medium text-muted-foreground">Agents</span>
          <Button variant="ghost" size="sm" className="h-7 w-7 p-0" onClick={handleCreateAgent}>
            <Plus className="size-4" />
          </Button>
        </div>

        <div className="flex-1 overflow-auto p-2">
          <div className="space-y-1">
            {agents.map((agent) => (
              <button
                key={agent.id}
                onClick={() => setSelectedAgentId(agent.id)}
                className={cn(
                  "w-full rounded-md px-3 py-2.5 text-left transition-colors",
                  selectedAgentId === agent.id
                    ? "bg-primary/10 text-foreground"
                    : "hover:bg-background-interactive"
                )}
              >
                <div className="flex items-center gap-2">
                  {agent.isOrchestrator ? (
                    <Bot className="size-4 text-primary" />
                  ) : (
                    <UserRound className="size-4 text-muted-foreground" />
                  )}
                  <span className="truncate text-sm font-medium">{agent.name}</span>
                </div>
                <p className="mt-0.5 truncate pl-6 text-[11px] text-muted-foreground">
                  {formatRelativeTime(
                    activityByAgentId.get(agent.id)?.lastActiveAt || null,
                    currentTimeMs
                  )}
                </p>
              </button>
            ))}
          </div>
        </div>

        {/* ZeroClaw summary */}
        {zeroClawDeployments.length > 0 && (
          <div className="border-t border-border/30 p-3">
            <button
              onClick={() => setShowZeroClawView(true)}
              className="w-full rounded-md bg-background-interactive px-3 py-2 text-left text-xs transition-colors hover:bg-border/30"
            >
              <span className="text-muted-foreground">ZeroClaw</span>
              <span className="ml-2 text-foreground">{zeroClawRunningCount} running</span>
            </button>
          </div>
        )}

        {/* Import/Export */}
        <div className="border-t border-border/30 p-3">
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              className="h-7 flex-1 text-xs"
              onClick={() => void handleExportBundle("json")}
              disabled={isBundleBusy}
            >
              <Download className="mr-1 size-3" />
              Export
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 flex-1 text-xs"
              onClick={handleImportBundle}
              disabled={isBundleBusy}
            >
              <Upload className="mr-1 size-3" />
              Import
            </Button>
          </div>
          {agentBundleStatus && (
            <p className="mt-2 text-[10px] text-muted-foreground">{agentBundleStatus}</p>
          )}
        </div>
      </aside>

      {/* Main Content */}
      <main className="min-h-0 flex-1 overflow-y-auto">
        {!selectedAgent ? (
          <div className="flex h-full items-center justify-center">
            <p className="text-sm text-muted-foreground">Select or create an agent</p>
          </div>
        ) : (
          <div className="mx-auto max-w-2xl space-y-6 p-6">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-3">
                <h1 className="text-lg font-medium">{selectedAgent.name}</h1>
                {selectedAgent.isOrchestrator && (
                  <Badge variant="info" className="text-[10px]">
                    Orchestrator
                  </Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="ghost" size="sm" onClick={handleOpenDirectChat}>
                  <MessageSquare className="mr-1.5 size-3.5" />
                  Chat
                </Button>
                <Button variant="ghost" size="sm" onClick={handleDelete}>
                  <Trash2 className="mr-1.5 size-3.5" />
                  Delete
                </Button>
                <Button size="sm" onClick={handleSave} disabled={isSaving}>
                  <Save className="mr-1.5 size-3.5" />
                  Save
                </Button>
              </div>
            </div>

            {/* Basic Info */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="form-group">
                <label className="form-label">Name</label>
                <Input
                  value={form.name}
                  onChange={(e) => setForm((p) => ({ ...p, name: e.target.value }))}
                />
              </div>
              <div className="form-group">
                <label className="form-label">Role</label>
                <Input
                  value={form.role}
                  onChange={(e) => setForm((p) => ({ ...p, role: e.target.value }))}
                />
              </div>
            </div>

            {/* Model Selection */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="form-group">
                <label className="form-label">Provider</label>
                <select
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  value={form.modelProvider}
                  onChange={(e) =>
                    setForm((p) => ({
                      ...p,
                      modelProvider: e.target.value as AgentFormState["modelProvider"],
                      modelName:
                        models.find((m) => m.provider === e.target.value)?.model || p.modelName
                    }))
                  }
                >
                  {providerOptions.map((id) => (
                    <option key={id} value={id}>
                      {id}
                    </option>
                  ))}
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Model</label>
                <select
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  value={form.modelName}
                  onChange={(e) => setForm((p) => ({ ...p, modelName: e.target.value }))}
                >
                  {modelOptions.map((m) => (
                    <option key={m.id} value={m.model}>
                      {m.name}
                    </option>
                  ))}
                  {modelOptions.length === 0 && (
                    <option value={form.modelName}>{form.modelName}</option>
                  )}
                </select>
              </div>
            </div>

            {/* Memory & Tags */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="form-group">
                <label className="form-label">Memory Scope</label>
                <select
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  value={form.memoryScope}
                  onChange={(e) =>
                    setForm((p) => ({ ...p, memoryScope: e.target.value as "private" | "shared" }))
                  }
                >
                  <option value="private">Private</option>
                  <option value="shared">Shared</option>
                </select>
              </div>
              <div className="form-group">
                <label className="form-label">Tags</label>
                <Input
                  value={form.tags}
                  onChange={(e) => setForm((p) => ({ ...p, tags: e.target.value }))}
                  placeholder="coding, research"
                />
              </div>
            </div>

            {/* System Prompt */}
            <div className="form-group">
              <label className="form-label">System Prompt</label>
              <textarea
                className="min-h-[160px] w-full rounded-md border border-border/60 bg-background p-3 text-sm"
                value={form.systemPrompt}
                onChange={(e) => setForm((p) => ({ ...p, systemPrompt: e.target.value }))}
              />
            </div>

            {/* Orchestrator Toggle */}
            <label className="flex cursor-pointer items-center gap-2">
              <input
                type="checkbox"
                checked={form.isOrchestrator}
                onChange={(e) => setForm((p) => ({ ...p, isOrchestrator: e.target.checked }))}
                className="size-4 rounded border-border"
              />
              <span className="text-sm">Mark as orchestrator</span>
            </label>

            {/* Collapsible: Skills */}
            <CollapsibleSection title="Skills Configuration">
              <div className="space-y-3">
                <div className="form-group">
                  <label className="form-label">Skill Access Mode</label>
                  <select
                    className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                    value={form.skillMode}
                    onChange={(e) =>
                      setForm((p) => ({ ...p, skillMode: e.target.value as AgentSkillMode }))
                    }
                  >
                    <option value="global_only">Global only</option>
                    <option value="global_plus_selected">Global + selected</option>
                    <option value="selected_only">Selected only</option>
                  </select>
                </div>
                <div className="max-h-48 space-y-1 overflow-auto">
                  {availableSkills.map((skill) => {
                    const selected = form.skillsAllowlist.includes(skill.name)
                    return (
                      <button
                        key={skill.id}
                        onClick={() => toggleSkillAllowlist(skill.name)}
                        className={cn(
                          "w-full rounded-md border px-3 py-2 text-left text-sm transition-colors",
                          selected
                            ? "border-primary/50 bg-primary/5"
                            : "border-border/40 hover:bg-background-interactive"
                        )}
                      >
                        <span className="font-medium">{skill.name}</span>
                        <p className="mt-0.5 line-clamp-1 text-xs text-muted-foreground">
                          {skill.description}
                        </p>
                      </button>
                    )
                  })}
                </div>
              </div>
            </CollapsibleSection>

            {/* Collapsible: Tool/Connector Allowlists */}
            <CollapsibleSection title="Tool & Connector Access">
              <div className="space-y-4">
                <div className="form-group">
                  <label className="form-label">Tool Allowlist</label>
                  <Input
                    value={form.toolAllowlist}
                    onChange={(e) => setForm((p) => ({ ...p, toolAllowlist: e.target.value }))}
                    placeholder="read_file, write_file, execute"
                  />
                  <p className="form-hint">Comma-separated tool names</p>
                </div>
                <div className="form-group">
                  <label className="form-label">Connector Allowlist</label>
                  <Input
                    value={form.connectorAllowlist}
                    onChange={(e) => setForm((p) => ({ ...p, connectorAllowlist: e.target.value }))}
                    placeholder="github, slack"
                  />
                  <p className="form-hint">Comma-separated connector keys</p>
                </div>
              </div>
            </CollapsibleSection>

            {/* Collapsible: Policy Presets */}
            <CollapsibleSection title="Security Policies">
              <div className="space-y-4">
                <p className="text-xs text-muted-foreground">
                  Apply a preset to quickly configure tool permissions.
                </p>
                {policyUiError && <p className="text-xs text-status-critical">{policyUiError}</p>}
                <div className="flex flex-wrap gap-2">
                  {POLICY_PRESETS.map((preset) => (
                    <Button
                      key={preset.id}
                      variant="outline"
                      size="sm"
                      disabled={isPolicySaving}
                      onClick={() => applyPolicyPreset(preset.id)}
                      title={preset.description}
                    >
                      {preset.label}
                    </Button>
                  ))}
                </div>
                <div className="flex items-center gap-2">
                  <select
                    className="h-8 rounded-md border border-border/60 bg-background px-2 text-xs"
                    value={policyScope}
                    onChange={(e) => setPolicyScope(e.target.value as "workspace" | "global")}
                  >
                    <option value="workspace">Workspace scope</option>
                    <option value="global">Global scope</option>
                  </select>
                  {isPolicySaving && (
                    <span className="text-xs text-muted-foreground">Saving...</span>
                  )}
                </div>
              </div>
            </CollapsibleSection>
          </div>
        )}
      </main>
    </div>
  )
}
