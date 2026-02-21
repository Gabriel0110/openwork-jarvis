import { useCallback, useEffect, useMemo, useState } from "react"
import {
  Bot,
  Download,
  Play,
  Plus,
  RotateCcw,
  Save,
  Square,
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
  ZeroClawDeploymentState,
  ZeroClawRuntimeHealth
} from "@/types"
import {
  POLICY_PRESETS,
  TOOL_POLICY_ROWS,
  areConstraintDraftsEqual,
  constraintDraftToPolicy,
  getDefaultToolDecision,
  policyToConstraintDraft,
  type PolicyConstraintDraft,
  type PolicyPresetId,
  validateConstraintDraft
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

function getRiskTierBadge(tier: "tier0" | "tier1" | "tier2"): { label: string; className: string } {
  switch (tier) {
    case "tier0":
      return {
        label: "T0",
        className: "border-emerald-300 bg-emerald-500/10 text-emerald-700"
      }
    case "tier1":
      return {
        label: "T1",
        className: "border-amber-300 bg-amber-500/10 text-amber-700"
      }
    case "tier2":
      return {
        label: "T2",
        className: "border-red-300 bg-red-500/10 text-red-700"
      }
  }
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

const ADVANCED_POLICY_ROWS: PolicyMatrixRow[] = [
  {
    resourceType: "filesystem",
    resourceKey: "*",
    action: "read",
    label: "Filesystem Read Overlay",
    riskTier: "tier0",
    displayKey: "filesystem:*"
  },
  {
    resourceType: "filesystem",
    resourceKey: "*",
    action: "write",
    label: "Filesystem Write Overlay",
    riskTier: "tier1",
    displayKey: "filesystem:*"
  },
  {
    resourceType: "network",
    resourceKey: "*",
    action: "exec",
    label: "Outbound Network Calls",
    riskTier: "tier2",
    displayKey: "network:*"
  },
  {
    resourceType: "network",
    resourceKey: "*",
    action: "post",
    label: "External Posting",
    riskTier: "tier2",
    displayKey: "network:*"
  },
  {
    resourceType: "connector",
    resourceKey: "*",
    action: "post",
    label: "Connector Posting",
    riskTier: "tier2",
    displayKey: "connector:*"
  }
]

function buildConnectorPolicyRows(connectorAllowlist: string[]): PolicyMatrixRow[] {
  return connectorAllowlist
    .map((connector) => connector.trim().toLowerCase().replace(/\s+/g, "_"))
    .filter(Boolean)
    .map((connectorKey) => ({
      resourceType: "connector" as const,
      resourceKey: connectorKey,
      action: "post" as const,
      label: `Connector ${connectorKey} Posting`,
      riskTier: "tier2" as const,
      displayKey: `connector:${connectorKey}`
    }))
}

function getPolicyRowKey(row: {
  resourceType: string
  resourceKey: string
  action: string
}): string {
  return `${row.resourceType}:${row.resourceKey}:${row.action}`
}

function toEventTimestamp(value: Date | string | number | undefined): number {
  if (value instanceof Date) {
    return value.getTime()
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function formatRelativeTime(timestampMs: number | null, nowMs: number): string {
  if (!timestampMs) {
    return "No activity"
  }
  const deltaMs = Math.max(0, nowMs - timestampMs)
  const minutes = Math.floor(deltaMs / (60 * 1000))
  if (minutes < 1) {
    return "just now"
  }
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) {
    return `${hours}h ago`
  }
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}

function getZeroClawStatusVariant(
  status: ZeroClawDeploymentState["status"]
): "outline" | "nominal" | "warning" | "critical" {
  switch (status) {
    case "running":
      return "nominal"
    case "starting":
    case "stopping":
      return "warning"
    case "error":
      return "critical"
    default:
      return "outline"
  }
}

function getZeroClawHealthVariant(
  status: ZeroClawRuntimeHealth["status"]
): "outline" | "nominal" | "warning" | "critical" {
  switch (status) {
    case "healthy":
      return "nominal"
    case "degraded":
      return "warning"
    case "unhealthy":
      return "critical"
    default:
      return "outline"
  }
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
  const [policyConstraintDrafts, setPolicyConstraintDrafts] = useState<
    Record<string, PolicyConstraintDraft>
  >({})
  const [policyUiError, setPolicyUiError] = useState<string | null>(null)
  const [policyScope, setPolicyScope] =
    useState<Extract<PolicyScope, "workspace" | "global">>("workspace")
  const [agentBundleStatus, setAgentBundleStatus] = useState<string | null>(null)
  const [isBundleBusy, setIsBundleBusy] = useState(false)
  const [activityEvents, setActivityEvents] = useState<TimelineEvent[]>([])
  const [activityStatus, setActivityStatus] = useState<string | null>(null)
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now())
  const [availableSkills, setAvailableSkills] = useState<SkillDefinition[]>([])
  const [skillStatus, setSkillStatus] = useState<string | null>(null)
  const [zeroClawDeployments, setZeroClawDeployments] = useState<ZeroClawDeploymentState[]>([])
  const [zeroClawHealthByDeploymentId, setZeroClawHealthByDeploymentId] = useState<
    Record<string, ZeroClawRuntimeHealth>
  >({})
  const [zeroClawStatus, setZeroClawStatus] = useState<string | null>(null)
  const [zeroClawActionBusyKey, setZeroClawActionBusyKey] = useState<string | null>(null)

  const workspaceId = useMemo(() => agents[0]?.workspaceId || "default-workspace", [agents])

  const loadZeroClawDeployments = useCallback(async (): Promise<void> => {
    try {
      const deployments = await window.api.zeroclaw.deployment.list(workspaceId)
      setZeroClawDeployments(deployments)

      const nextHealth: Record<string, ZeroClawRuntimeHealth> = {}
      await Promise.all(
        deployments.map(async (deployment) => {
          if (deployment.status !== "running" && deployment.status !== "starting") {
            return
          }
          try {
            const health = await window.api.zeroclaw.runtime.getHealth(deployment.id)
            nextHealth[deployment.id] = health
          } catch {
            // Health probes are best-effort in this summary surface.
          }
        })
      )
      setZeroClawHealthByDeploymentId(nextHealth)
      setZeroClawStatus(null)
    } catch (error) {
      setZeroClawStatus(
        `Failed to load ZeroClaw deployments: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }, [workspaceId])

  useEffect(() => {
    loadAgents()
    loadModels()
    loadProviders()
    void Promise.all([window.api.skills.list(), loadZeroClawDeployments()])
      .then(([result]) => {
        setAvailableSkills(result.skills)
        setSkillStatus(null)
      })
      .catch((error) => {
        setSkillStatus(
          `Failed to load skills: ${error instanceof Error ? error.message : "Unknown error"}`
        )
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
        if (!cancelled) {
          setActivityEvents(events)
        }
      } catch (error) {
        if (!cancelled) {
          setActivityStatus(
            `Failed to load activity: ${error instanceof Error ? error.message : "Unknown error"}`
          )
        }
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
    const now = Date.now()
    const cutoff = now - 24 * 60 * 60 * 1000
    const map = new Map<
      string,
      {
        lastActiveAt: number | null
        runs24h: number
        events: TimelineEvent[]
      }
    >()

    const sorted = [...activityEvents].sort(
      (left, right) => toEventTimestamp(right.occurredAt) - toEventTimestamp(left.occurredAt)
    )
    for (const event of sorted) {
      const associatedIds = new Set<string>()
      if (event.sourceAgentId) {
        associatedIds.add(event.sourceAgentId)
      }
      if (event.targetAgentId) {
        associatedIds.add(event.targetAgentId)
      }
      if (associatedIds.size === 0) {
        continue
      }

      const occurredAt = toEventTimestamp(event.occurredAt)
      for (const agentId of associatedIds) {
        const entry = map.get(agentId) || {
          lastActiveAt: null,
          runs24h: 0,
          events: []
        }
        if (!entry.lastActiveAt || occurredAt > entry.lastActiveAt) {
          entry.lastActiveAt = occurredAt
        }
        if (occurredAt >= cutoff) {
          entry.runs24h += 1
        }
        if (entry.events.length < 10) {
          entry.events.push(event)
        }
        map.set(agentId, entry)
      }
    }

    return map
  }, [activityEvents])
  const selectedAgentRecentEvents = useMemo(() => {
    if (!selectedAgent) {
      return []
    }
    return (activityByAgentId.get(selectedAgent.id)?.events || []).slice(0, 6)
  }, [activityByAgentId, selectedAgent])
  const zeroClawRunningCount = useMemo(
    () =>
      zeroClawDeployments.filter(
        (deployment) => deployment.status === "running" || deployment.status === "starting"
      ).length,
    [zeroClawDeployments]
  )
  const connectorPolicyRows = useMemo<PolicyMatrixRow[]>(
    () => buildConnectorPolicyRows(selectedAgent?.connectorAllowlist || []),
    [selectedAgent?.connectorAllowlist]
  )
  const advancedPolicyRows = useMemo<PolicyMatrixRow[]>(
    () => [...ADVANCED_POLICY_ROWS, ...connectorPolicyRows],
    [connectorPolicyRows]
  )
  const allPolicyRows = useMemo<PolicyMatrixRow[]>(
    () => [...TOOL_POLICY_MATRIX_ROWS, ...advancedPolicyRows],
    [advancedPolicyRows]
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
        setPolicyUiError(null)
        return
      }

      const loaded = await window.api.policies.list(selectedAgentId)
      setPolicies(loaded)

      const nextDrafts: Record<string, PolicyConstraintDraft> = {}
      for (const row of allPolicyRows) {
        const explicit = loaded.find(
          (policy) =>
            policy.resourceType === row.resourceType &&
            policy.resourceKey === row.resourceKey &&
            policy.action === row.action &&
            policy.scope === policyScope
        )
        nextDrafts[getPolicyRowKey(row)] = policyToConstraintDraft(explicit)
      }
      setPolicyConstraintDrafts(nextDrafts)
    }

    loadPolicies()
  }, [selectedAgentId, policyScope, allPolicyRows])

  const providerOptions = providers.length
    ? providers.map((provider) => provider.id)
    : (["anthropic", "openai", "google"] as const)
  const modelOptions = models.filter((model) => model.provider === form.modelProvider)

  async function handleCreateAgent(): Promise<void> {
    const fallbackModel = modelOptions[0]?.model || "claude-sonnet-4-5-20250929"
    const created = await createAgent({
      name: "New Agent",
      role: "Specialist",
      systemPrompt: "You are a specialist agent. Complete tasks accurately and concisely.",
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
          .map((tag) => tag.trim())
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
    setActivityStatus(null)
    try {
      await createThread({
        title: `${selectedAgent.name} Session`,
        workspaceId,
        speakerType: "agent",
        speakerAgentId: selectedAgent.id
      })
    } catch (error) {
      setActivityStatus(
        `Failed to open direct chat: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  async function handleRunSanityTest(): Promise<void> {
    if (!selectedAgent) return
    setActivityStatus(null)
    try {
      await createThread({
        title: `${selectedAgent.name} Sanity Check`,
        workspaceId,
        speakerType: "agent",
        speakerAgentId: selectedAgent.id,
        templateStarterPrompt:
          "Run a quick sanity self-check: summarize your role, list enabled tools you can use safely, and propose one small actionable next step."
      })
    } catch (error) {
      setActivityStatus(
        `Failed to run sanity test: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  async function handleOpenZeroClawChat(deployment: ZeroClawDeploymentState): Promise<void> {
    setZeroClawStatus(null)
    try {
      await createThread({
        title: `${deployment.name} Session`,
        workspaceId: deployment.workspaceId,
        speakerType: "zeroclaw",
        speakerAgentId: deployment.id
      })
    } catch (error) {
      setZeroClawStatus(
        `Failed to open ZeroClaw chat: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  async function handleZeroClawRuntimeAction(
    deployment: ZeroClawDeploymentState,
    action: "start" | "stop" | "restart"
  ): Promise<void> {
    const busyKey = `${action}:${deployment.id}`
    setZeroClawActionBusyKey(busyKey)
    setZeroClawStatus(null)
    try {
      if (action === "start") {
        await window.api.zeroclaw.runtime.start(deployment.id)
      } else if (action === "stop") {
        await window.api.zeroclaw.runtime.stop(deployment.id)
      } else {
        await window.api.zeroclaw.runtime.restart(deployment.id)
      }
      await loadZeroClawDeployments()
    } catch (error) {
      setZeroClawStatus(
        `Failed to ${action} ${deployment.name}: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setZeroClawActionBusyKey((current) => (current === busyKey ? null : current))
    }
  }

  async function handleExportBundle(format: "json" | "yaml" = "json"): Promise<void> {
    setIsBundleBusy(true)
    setAgentBundleStatus(null)
    try {
      const bundle = await window.api.agents.exportBundle()
      const serialized = format === "yaml" ? stringifyYaml(bundle) : JSON.stringify(bundle, null, 2)
      await navigator.clipboard.writeText(serialized)
      setAgentBundleStatus(`Exported ${bundle.items.length} agents to clipboard ${format}.`)
    } catch (error) {
      setAgentBundleStatus(error instanceof Error ? error.message : "Failed to export agents.")
    } finally {
      setIsBundleBusy(false)
    }
  }

  async function handleImportBundle(): Promise<void> {
    const input = window.prompt("Paste exported agent bundle (JSON or YAML):")
    if (!input || input.trim().length === 0) {
      return
    }

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
      if (imported.length > 0) {
        setSelectedAgentId(imported[0].id)
      }
      setAgentBundleStatus(`Imported ${imported.length} agents from bundle.`)
    } catch (error) {
      setAgentBundleStatus(error instanceof Error ? error.message : "Failed to import agents.")
    } finally {
      setIsBundleBusy(false)
    }
  }

  function toggleSkillAllowlist(skillName: string): void {
    const normalized = skillName.trim()
    if (!normalized) {
      return
    }

    setForm((previous) => {
      const current = new Set(previous.skillsAllowlist.map((item) => item.trim()).filter(Boolean))
      if (current.has(normalized)) {
        current.delete(normalized)
      } else {
        current.add(normalized)
      }
      return {
        ...previous,
        skillsAllowlist: Array.from(current).sort((left, right) => left.localeCompare(right))
      }
    })
  }

  async function upsertPolicyRow(
    resourceType: "tool" | "filesystem" | "network" | "connector",
    resourceKey: string,
    action: "read" | "write" | "exec" | "post",
    decision: PolicyDecision,
    constraintDraft: PolicyConstraintDraft
  ): Promise<void> {
    if (!selectedAgentId) return
    setIsPolicySaving(true)
    setPolicyUiError(null)
    try {
      const existing = policies.find(
        (policy) =>
          policy.resourceType === resourceType &&
          policy.resourceKey === resourceKey &&
          policy.action === action &&
          policy.scope === policyScope
      )

      const updated = await window.api.policies.upsert({
        policyId: existing?.id,
        agentId: selectedAgentId,
        resourceType,
        resourceKey,
        action,
        scope: policyScope,
        decision,
        constraints: constraintDraftToPolicy(constraintDraft)
      })

      setPolicies((prev) => {
        const hasExisting = prev.some((policy) => policy.id === updated.id)
        if (hasExisting) {
          return prev.map((policy) => (policy.id === updated.id ? updated : policy))
        }
        return [updated, ...prev]
      })
      const key = getPolicyRowKey({ resourceType, resourceKey, action })
      setPolicyConstraintDrafts((prev) => ({
        ...prev,
        [key]: constraintDraft
      }))
    } catch (error) {
      setPolicyUiError(error instanceof Error ? error.message : "Failed to save policy.")
    } finally {
      setIsPolicySaving(false)
    }
  }

  async function upsertPoliciesBulk(
    entries: Array<{
      resourceType: "tool" | "filesystem" | "network" | "connector"
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
            (policy) =>
              policy.resourceType === entry.resourceType &&
              policy.resourceKey === entry.resourceKey &&
              policy.action === entry.action &&
              policy.scope === policyScope
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

          return {
            updated,
            key: getPolicyRowKey(entry),
            draft: entry.constraintDraft
          }
        })
      )

      setPolicies((prev) => {
        let next = [...prev]
        for (const { updated } of updates) {
          const index = next.findIndex((policy) => policy.id === updated.id)
          if (index >= 0) {
            next[index] = updated
          } else {
            next = [updated, ...next]
          }
        }
        return next
      })

      setPolicyConstraintDrafts((prev) => {
        const next = { ...prev }
        for (const { key, draft } of updates) {
          next[key] = draft
        }
        return next
      })
    } catch (error) {
      setPolicyUiError(error instanceof Error ? error.message : "Failed to save policies.")
    } finally {
      setIsPolicySaving(false)
    }
  }

  async function applyPolicyPreset(presetId: PolicyPresetId): Promise<void> {
    const preset = POLICY_PRESETS.find((item) => item.id === presetId)
    if (!preset) return

    const entries = TOOL_POLICY_MATRIX_ROWS.map((row) => {
      const rule = preset.byAction[row.action]
      return {
        resourceType: row.resourceType,
        resourceKey: row.resourceKey,
        action: row.action,
        decision: rule.decision,
        constraintDraft: { ...rule.constraints }
      }
    })

    await upsertPoliciesBulk(entries)
  }

  async function saveAllPolicyRows(): Promise<void> {
    const entries: Array<{
      resourceType: "tool" | "filesystem" | "network" | "connector"
      resourceKey: string
      action: "read" | "write" | "exec" | "post"
      decision: PolicyDecision
      constraintDraft: PolicyConstraintDraft
    }> = []

    for (const row of allPolicyRows) {
      const explicit = policies.find(
        (policy) =>
          policy.resourceType === row.resourceType &&
          policy.resourceKey === row.resourceKey &&
          policy.action === row.action &&
          policy.scope === policyScope
      )
      const persistedDraft = policyToConstraintDraft(explicit)
      const currentDraft = policyConstraintDrafts[getPolicyRowKey(row)] || persistedDraft
      const validation = validateConstraintDraft(currentDraft)

      if (validation.hasError) {
        setPolicyUiError(`Fix validation errors before saving all policies (row: ${row.label}).`)
        return
      }

      entries.push({
        resourceType: row.resourceType,
        resourceKey: row.resourceKey,
        action: row.action,
        decision:
          explicit?.decision ||
          (row.resourceType === "tool" ? getDefaultToolDecision(row.resourceKey) : "ask"),
        constraintDraft: currentDraft
      })
    }

    await upsertPoliciesBulk(entries)
  }

  function resetAllConstraintDrafts(): void {
    const nextDrafts: Record<string, PolicyConstraintDraft> = {}
    for (const row of allPolicyRows) {
      const explicit = policies.find(
        (policy) =>
          policy.resourceType === row.resourceType &&
          policy.resourceKey === row.resourceKey &&
          policy.action === row.action &&
          policy.scope === policyScope
      )
      nextDrafts[getPolicyRowKey(row)] = policyToConstraintDraft(explicit)
    }
    setPolicyConstraintDrafts(nextDrafts)
    setPolicyUiError(null)
  }

  function renderPolicyRow(row: PolicyMatrixRow): React.JSX.Element {
    const policyKey = getPolicyRowKey(row)
    const explicit = policies.find(
      (policy) =>
        policy.resourceType === row.resourceType &&
        policy.resourceKey === row.resourceKey &&
        policy.action === row.action &&
        policy.scope === policyScope
    )
    const currentDecision =
      explicit?.decision ||
      (row.resourceType === "tool" ? getDefaultToolDecision(row.resourceKey) : "ask")
    const persistedConstraintDraft = policyToConstraintDraft(explicit)
    const constraintDraft = policyConstraintDrafts[policyKey] || persistedConstraintDraft
    const validation = validateConstraintDraft(constraintDraft)
    const hasUnsavedConstraintChanges = !areConstraintDraftsEqual(
      constraintDraft,
      persistedConstraintDraft
    )

    return (
      <div
        key={`${row.resourceType}:${row.resourceKey}:${row.action}`}
        className="rounded-sm border border-border px-2 py-2"
      >
        <div className="grid grid-cols-[1fr_140px] items-center gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <div className="truncate text-sm">{row.label}</div>
              <span
                className={cn(
                  "inline-flex rounded border px-1.5 py-0.5 text-[10px] font-medium",
                  getRiskTierBadge(row.riskTier).className
                )}
              >
                {getRiskTierBadge(row.riskTier).label}
              </span>
            </div>
            <div className="text-[11px] text-muted-foreground font-mono">
              {row.displayKey} ({row.action})
            </div>
          </div>
          <select
            className="h-8 w-full rounded-sm border border-border bg-background px-2 text-xs"
            value={currentDecision}
            onChange={(event) =>
              upsertPolicyRow(
                row.resourceType,
                row.resourceKey,
                row.action,
                event.target.value as PolicyDecision,
                validation.hasError ? persistedConstraintDraft : constraintDraft
              )
            }
          >
            <option value="allow">allow</option>
            <option value="ask">ask</option>
            <option value="deny">deny</option>
            <option value="allow_in_session">allow_in_session</option>
          </select>
        </div>
        {hasUnsavedConstraintChanges && (
          <div className="mt-1 text-[11px] text-amber-600">Unsaved constraint changes</div>
        )}

        <div className="mt-2 grid grid-cols-1 gap-2 sm:grid-cols-2">
          <div className="space-y-1">
            <label className="block text-[11px] text-muted-foreground">Path Regex (CSV)</label>
            <p className="text-[10px] text-muted-foreground">
              Example: <code>^/workspace/src/.*</code>, <code>^/workspace/docs/.*\\.md$</code>
            </p>
            <Input
              className="h-8"
              placeholder="^/workspace/src/.*, ^/workspace/docs/.*"
              value={constraintDraft.pathRegex}
              onChange={(event) =>
                setPolicyConstraintDrafts((prev) => ({
                  ...prev,
                  [policyKey]: {
                    ...constraintDraft,
                    pathRegex: event.target.value
                  }
                }))
              }
            />
            {validation.pathRegexError && (
              <p className="text-[11px] text-destructive">{validation.pathRegexError}</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] text-muted-foreground">
              Domain Allowlist (CSV)
            </label>
            <p className="text-[10px] text-muted-foreground">
              Hostnames only. Supports subdomains, e.g. <code>api.example.com</code> or{" "}
              <code>*.example.com</code>.
            </p>
            <Input
              className="h-8"
              placeholder="api.example.com, example.org"
              value={constraintDraft.domainAllowlist}
              onChange={(event) =>
                setPolicyConstraintDrafts((prev) => ({
                  ...prev,
                  [policyKey]: {
                    ...constraintDraft,
                    domainAllowlist: event.target.value
                  }
                }))
              }
            />
            {validation.domainAllowlistError && (
              <p className="text-[11px] text-destructive">{validation.domainAllowlistError}</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] text-muted-foreground">Rate Limit Max Calls</label>
            <p className="text-[10px] text-muted-foreground">
              Positive integer. Must be set together with window seconds.
            </p>
            <Input
              className="h-8"
              type="number"
              min={1}
              step={1}
              placeholder="3"
              value={constraintDraft.rateLimitMaxCalls}
              onChange={(event) =>
                setPolicyConstraintDrafts((prev) => ({
                  ...prev,
                  [policyKey]: {
                    ...constraintDraft,
                    rateLimitMaxCalls: event.target.value
                  }
                }))
              }
            />
            {validation.rateLimitMaxCallsError && (
              <p className="text-[11px] text-destructive">{validation.rateLimitMaxCallsError}</p>
            )}
          </div>
          <div className="space-y-1">
            <label className="block text-[11px] text-muted-foreground">
              Rate Limit Window (seconds)
            </label>
            <p className="text-[10px] text-muted-foreground">
              Time window for max calls (example: <code>60</code> = per minute).
            </p>
            <div className="flex items-center gap-2">
              <Input
                className="h-8"
                type="number"
                min={1}
                step={1}
                placeholder="60"
                value={constraintDraft.rateLimitWindowSeconds}
                onChange={(event) =>
                  setPolicyConstraintDrafts((prev) => ({
                    ...prev,
                    [policyKey]: {
                      ...constraintDraft,
                      rateLimitWindowSeconds: event.target.value
                    }
                  }))
                }
              />
              <Button
                variant="outline"
                size="sm"
                disabled={!hasUnsavedConstraintChanges || validation.hasError}
                onClick={() =>
                  upsertPolicyRow(
                    row.resourceType,
                    row.resourceKey,
                    row.action,
                    currentDecision,
                    constraintDraft
                  )
                }
              >
                Save
              </Button>
            </div>
            {validation.rateLimitWindowSecondsError && (
              <p className="text-[11px] text-destructive">
                {validation.rateLimitWindowSecondsError}
              </p>
            )}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-1 min-h-0 bg-background">
      <aside className="w-72 border-r border-border bg-sidebar p-3 space-y-2">
        <Button
          variant="default"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleCreateAgent}
        >
          <Plus className="size-4" />
          New Agent
        </Button>
        <div className="grid grid-cols-3 gap-1">
          <Button
            variant="outline"
            size="sm"
            className="justify-start gap-1.5"
            onClick={() => {
              void handleExportBundle("json")
            }}
            disabled={isBundleBusy}
          >
            <Download className="size-3.5" />
            JSON
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="justify-start gap-1.5"
            onClick={() => {
              void handleExportBundle("yaml")
            }}
            disabled={isBundleBusy}
          >
            <Download className="size-3.5" />
            YAML
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="justify-start gap-1.5"
            onClick={handleImportBundle}
            disabled={isBundleBusy}
          >
            <Upload className="size-3.5" />
            Import
          </Button>
        </div>
        {agentBundleStatus && (
          <div className="rounded-sm border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
            {agentBundleStatus}
          </div>
        )}

        <div className="text-section-header px-2 pt-2">AGENT REGISTRY</div>
        <div className="space-y-1 max-h-[calc(100vh-180px)] overflow-y-auto pr-1">
          {agents.map((agent) => (
            <button
              key={agent.id}
              onClick={() => setSelectedAgentId(agent.id)}
              className={cn(
                "w-full rounded-sm border px-2 py-2 text-left transition-colors",
                selectedAgentId === agent.id
                  ? "border-primary bg-primary/10"
                  : "border-border hover:bg-background-interactive"
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
              <div className="mt-1 truncate text-xs text-muted-foreground">{agent.role}</div>
              <div className="mt-1 text-[10px] text-muted-foreground">
                Last:{" "}
                {formatRelativeTime(
                  activityByAgentId.get(agent.id)?.lastActiveAt || null,
                  currentTimeMs
                )}
              </div>
            </button>
          ))}
          {agents.length === 0 && (
            <div className="rounded-sm border border-dashed border-border p-3 text-xs text-muted-foreground">
              No agents yet.
            </div>
          )}
        </div>

        <div className="mt-3 flex items-center justify-between px-2">
          <div className="text-section-header">ZEROCLAW DEPLOYMENTS</div>
          <Badge variant="outline">
            {zeroClawRunningCount}/{zeroClawDeployments.length} RUNNING
          </Badge>
        </div>
        <Button
          variant="outline"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => setShowZeroClawView(true)}
        >
          <Bot className="size-4" />
          Open ZeroClaw Control
        </Button>
        {zeroClawStatus && (
          <div className="rounded-sm border border-border bg-background px-2 py-1 text-[11px] text-muted-foreground">
            {zeroClawStatus}
          </div>
        )}
        <div className="space-y-1 max-h-72 overflow-y-auto pr-1">
          {zeroClawDeployments.length === 0 ? (
            <div className="rounded-sm border border-dashed border-border p-3 text-xs text-muted-foreground">
              No ZeroClaw deployments found.
            </div>
          ) : (
            zeroClawDeployments.map((deployment) => {
              const health = zeroClawHealthByDeploymentId[deployment.id]
              const isRunning = deployment.status === "running" || deployment.status === "starting"
              const actionLabel = isRunning ? "Stop" : "Start"
              const actionIcon = isRunning ? Square : Play
              const actionKey = `${isRunning ? "stop" : "start"}:${deployment.id}`
              const restartKey = `restart:${deployment.id}`
              const ActionIcon = actionIcon

              return (
                <div key={deployment.id} className="rounded-sm border border-border px-2 py-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{deployment.name}</div>
                      <div className="truncate text-[11px] text-muted-foreground">
                        {deployment.modelProvider}/{deployment.modelName}
                      </div>
                    </div>
                    <Badge variant={getZeroClawStatusVariant(deployment.status)}>
                      {deployment.status}
                    </Badge>
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                    <span className="font-mono">{deployment.apiBaseUrl}</span>
                    {health && (
                      <Badge variant={getZeroClawHealthVariant(health.status)}>
                        {health.status}
                      </Badge>
                    )}
                  </div>
                  {deployment.lastError && (
                    <div className="mt-1 text-[10px] text-status-critical line-clamp-2">
                      {deployment.lastError}
                    </div>
                  )}
                  <div className="mt-2 flex items-center gap-1">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => {
                        void handleOpenZeroClawChat(deployment)
                      }}
                    >
                      Chat
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      disabled={zeroClawActionBusyKey === actionKey}
                      onClick={() => {
                        void handleZeroClawRuntimeAction(deployment, isRunning ? "stop" : "start")
                      }}
                    >
                      <ActionIcon className="mr-1 size-3" />
                      {actionLabel}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 px-2 text-[10px]"
                      disabled={zeroClawActionBusyKey === restartKey}
                      onClick={() => {
                        void handleZeroClawRuntimeAction(deployment, "restart")
                      }}
                    >
                      <RotateCcw className="mr-1 size-3" />
                      Restart
                    </Button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </aside>

      <main className="flex-1 min-h-0 overflow-y-auto p-5">
        {!selectedAgent ? (
          <div className="flex h-full items-center justify-center text-muted-foreground">
            Select or create an agent to edit configuration.
          </div>
        ) : (
          <div className="mx-auto w-full max-w-3xl space-y-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-semibold">{selectedAgent.name}</h2>
                {selectedAgent.isOrchestrator && <Badge variant="info">ORCHESTRATOR</Badge>}
              </div>
              <div className="flex items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleOpenDirectChat}>
                  Direct Chat
                </Button>
                <Button variant="outline" size="sm" onClick={handleRunSanityTest}>
                  Test Run
                </Button>
                <Button variant="outline" size="sm" onClick={handleDelete}>
                  <Trash2 className="mr-1.5 size-3.5" />
                  Delete
                </Button>
                <Button variant="default" size="sm" onClick={handleSave} disabled={isSaving}>
                  <Save className="mr-1.5 size-3.5" />
                  Save
                </Button>
              </div>
            </div>
            <div className="rounded-sm border border-border p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Badge variant="outline">
                  Last active:{" "}
                  {formatRelativeTime(
                    activityByAgentId.get(selectedAgent.id)?.lastActiveAt || null,
                    currentTimeMs
                  )}
                </Badge>
                <Badge variant="outline">
                  Activity (24h): {activityByAgentId.get(selectedAgent.id)?.runs24h || 0}
                </Badge>
              </div>
              <div className="mt-2 space-y-1">
                {selectedAgentRecentEvents.length === 0 ? (
                  <div className="text-xs text-muted-foreground">
                    No recent runs for this agent.
                  </div>
                ) : (
                  selectedAgentRecentEvents.map((event) => (
                    <div
                      key={event.id}
                      className="rounded-sm border border-border/70 px-2 py-1 text-xs text-muted-foreground"
                    >
                      <div className="truncate">
                        {(event.summary || `${event.eventType} ${event.toolName || ""}`).trim()}
                      </div>
                      <div className="mt-0.5 text-[10px]">
                        {new Date(toEventTimestamp(event.occurredAt)).toLocaleString()}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
            {activityStatus && (
              <div className="rounded-sm border border-border px-2 py-1 text-[11px] text-muted-foreground">
                {activityStatus}
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Name</label>
                <Input
                  value={form.name}
                  onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Role</label>
                <Input
                  value={form.role}
                  onChange={(event) => setForm((prev) => ({ ...prev, role: event.target.value }))}
                />
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Provider</label>
                <select
                  className="h-9 w-full rounded-sm border border-border bg-background px-3 text-sm"
                  value={form.modelProvider}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      modelProvider: event.target.value as AgentFormState["modelProvider"],
                      modelName:
                        models.find((item) => item.provider === event.target.value)?.model ||
                        prev.modelName
                    }))
                  }
                >
                  {providerOptions.map((providerId) => (
                    <option key={providerId} value={providerId}>
                      {providerId}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Model</label>
                <select
                  className="h-9 w-full rounded-sm border border-border bg-background px-3 text-sm"
                  value={form.modelName}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, modelName: event.target.value }))
                  }
                >
                  {modelOptions.map((model) => (
                    <option key={model.id} value={model.model}>
                      {model.name}
                    </option>
                  ))}
                  {modelOptions.length === 0 && (
                    <option value={form.modelName}>{form.modelName}</option>
                  )}
                </select>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">Memory Scope</label>
                <select
                  className="h-9 w-full rounded-sm border border-border bg-background px-3 text-sm"
                  value={form.memoryScope}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      memoryScope: event.target.value as AgentFormState["memoryScope"]
                    }))
                  }
                >
                  <option value="private">private</option>
                  <option value="shared">shared</option>
                </select>
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Tags (comma separated)
                </label>
                <Input
                  value={form.tags}
                  onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))}
                  placeholder="coding, research"
                />
              </div>
            </div>

            <div className="rounded-sm border border-border p-3">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="mb-1 block text-xs text-muted-foreground">
                    Skill Access Mode
                  </label>
                  <select
                    className="h-9 w-full rounded-sm border border-border bg-background px-3 text-sm"
                    value={form.skillMode}
                    onChange={(event) =>
                      setForm((prev) => ({
                        ...prev,
                        skillMode: event.target.value as AgentSkillMode
                      }))
                    }
                  >
                    <option value="global_only">global_only</option>
                    <option value="global_plus_selected">global_plus_selected</option>
                    <option value="selected_only">selected_only</option>
                  </select>
                </div>
                <div className="text-[11px] text-muted-foreground">
                  <div className="font-medium text-foreground">Modes</div>
                  <div>global_only: all global skills</div>
                  <div>global_plus_selected: global + selected</div>
                  <div>selected_only: selected skills only</div>
                </div>
              </div>

              {skillStatus && (
                <div className="mt-2 rounded-sm border border-border px-2 py-1 text-[11px] text-muted-foreground">
                  {skillStatus}
                </div>
              )}

              <div className="mt-3 text-xs text-muted-foreground">Assigned Skills</div>
              <div className="mt-2 max-h-40 space-y-1 overflow-auto pr-1">
                {availableSkills.length === 0 ? (
                  <div className="rounded-sm border border-border p-2 text-xs text-muted-foreground">
                    No global skills discovered.
                  </div>
                ) : (
                  availableSkills.map((skill) => {
                    const selected = form.skillsAllowlist.includes(skill.name)
                    return (
                      <button
                        key={skill.id}
                        onClick={() => toggleSkillAllowlist(skill.name)}
                        className={cn(
                          "w-full rounded-sm border px-2 py-1 text-left transition-colors",
                          selected
                            ? "border-primary bg-primary/10"
                            : "border-border hover:bg-background-interactive"
                        )}
                      >
                        <div className="truncate text-xs font-medium">{skill.name}</div>
                        <div className="truncate text-[11px] text-muted-foreground">
                          {skill.description}
                        </div>
                      </button>
                    )
                  })
                )}
              </div>
              <div className="mt-2 text-[11px] text-muted-foreground">
                Selected:{" "}
                {form.skillsAllowlist.length > 0 ? form.skillsAllowlist.join(", ") : "(none)"}
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Tool Allowlist (comma separated)
                </label>
                <Input
                  value={form.toolAllowlist}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, toolAllowlist: event.target.value }))
                  }
                  placeholder="read_file, write_file, execute"
                />
              </div>
              <div>
                <label className="mb-1 block text-xs text-muted-foreground">
                  Connector Allowlist (comma separated)
                </label>
                <Input
                  value={form.connectorAllowlist}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, connectorAllowlist: event.target.value }))
                  }
                  placeholder="github, slack"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <input
                id="isOrchestrator"
                type="checkbox"
                checked={form.isOrchestrator}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, isOrchestrator: event.target.checked }))
                }
              />
              <label htmlFor="isOrchestrator" className="text-sm text-muted-foreground">
                Mark as orchestrator
              </label>
            </div>

            <div>
              <label className="mb-1 block text-xs text-muted-foreground">System Prompt</label>
              <textarea
                className="min-h-[220px] w-full rounded-sm border border-border bg-background p-3 text-sm"
                value={form.systemPrompt}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, systemPrompt: event.target.value }))
                }
              />
            </div>

            <div className="rounded-sm border border-border p-3">
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs text-muted-foreground">Tool Policy Matrix</label>
                <div className="flex items-center gap-2">
                  {isPolicySaving && <Badge variant="outline">Saving...</Badge>}
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={isPolicySaving}
                    onClick={saveAllPolicyRows}
                  >
                    Save All
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={isPolicySaving}
                    onClick={resetAllConstraintDrafts}
                  >
                    Reset Drafts
                  </Button>
                  <select
                    className="h-8 rounded-sm border border-border bg-background px-2 text-xs"
                    value={policyScope}
                    onChange={(event) =>
                      setPolicyScope(
                        event.target.value as Extract<PolicyScope, "workspace" | "global">
                      )
                    }
                  >
                    <option value="workspace">workspace scope</option>
                    <option value="global">global scope</option>
                  </select>
                </div>
              </div>
              {policyUiError && (
                <div className="mb-2 rounded-sm border border-destructive/30 bg-destructive/10 px-2 py-1 text-xs text-destructive">
                  {policyUiError}
                </div>
              )}
              <div className="mb-2 text-[11px] text-muted-foreground">
                Editing <span className="font-medium">{policyScope}</span> policies.
                {policyScope === "workspace" && " Workspace policies override global policies."}
              </div>
              <div className="mb-2 flex items-center gap-2 text-[11px] text-muted-foreground">
                <span className="rounded border border-emerald-300 bg-emerald-500/10 px-1.5 py-0.5 text-emerald-700">
                  T0 read-only
                </span>
                <span className="rounded border border-amber-300 bg-amber-500/10 px-1.5 py-0.5 text-amber-700">
                  T1 write
                </span>
                <span className="rounded border border-red-300 bg-red-500/10 px-1.5 py-0.5 text-red-700">
                  T2 exec/network
                </span>
              </div>
              <div className="mb-3 flex flex-wrap items-center gap-2">
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
              <div className="space-y-2">
                {TOOL_POLICY_MATRIX_ROWS.map((row) => renderPolicyRow(row))}
              </div>
              <div className="mt-4">
                <div className="mb-2 text-xs text-muted-foreground">Advanced Policy Rules</div>
                <div className="space-y-2">
                  {advancedPolicyRows.map((row) => renderPolicyRow(row))}
                </div>
              </div>
            </div>
          </div>
        )}
      </main>
    </div>
  )
}
