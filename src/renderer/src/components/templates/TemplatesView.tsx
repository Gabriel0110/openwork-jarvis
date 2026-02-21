import { useCallback, useEffect, useMemo, useState } from "react"
import { Clock3, Copy, FileDown, FileUp, Play, Plus, Sparkles, Trash2 } from "lucide-react"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/lib/store"
import { getNextTemplateScheduleRunTimestamp } from "../../../../shared/template-schedule-preview"
import {
  parseRruleTokens,
  validateTemplateScheduleRrule
} from "../../../../shared/template-schedule"
import type {
  Thread,
  TimelineEvent,
  WorkflowTemplate,
  WorkflowTemplateExportBundle,
  WorkflowTemplatePolicyDefault,
  WorkflowTemplateScheduleRun,
  WorkflowTemplateTrigger
} from "@/types"

const DEFAULT_WORKSPACE_ID = "default-workspace"
const MAX_STARTER_PROMPT_LENGTH = 2000
const MAX_EXPECTED_ARTIFACTS = 8

interface HistoryMessage {
  role: "user" | "assistant" | "system" | "tool"
  content: string
}

interface SessionDeriveSummary {
  messageCount: number
  timelineCount: number
  connectorCount: number
  artifactCount: number
  policyCount: number
}

interface TemplateRunRef {
  threadId: string
  title: string
  updatedAtMs: number
  status: Thread["status"]
}

const TRIGGER_TYPE_OPTIONS: Array<{
  value: WorkflowTemplateTrigger["type"]
  label: string
}> = [
  { value: "timeline_event", label: "Timeline Event" },
  { value: "connector_event", label: "Connector Event" },
  { value: "webhook", label: "Webhook Event" }
]

const TRIGGER_EXECUTION_MODE_OPTIONS: Array<{
  value: WorkflowTemplateTrigger["executionMode"]
  label: string
}> = [
  { value: "notify", label: "Notify Only" },
  { value: "auto_run", label: "Auto-run (Guarded)" }
]

interface ExternalTriggerOption {
  key: string
  templateId: string
  templateName: string
  triggerId: string
  triggerType: "connector_event" | "webhook"
  eventKey: string
  sourceKey?: string
}

function toExternalTriggerType(
  type: WorkflowTemplateTrigger["type"]
): "connector_event" | "webhook" | null {
  if (type === "connector_event" || type === "webhook") {
    return type
  }
  return null
}

function generateTriggerId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID()
  }
  return `trigger-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

function createEmptyTrigger(
  type: WorkflowTemplateTrigger["type"] = "timeline_event"
): WorkflowTemplateTrigger {
  return {
    id: generateTriggerId(),
    type,
    enabled: true,
    executionMode: "notify",
    eventKey: "",
    sourceKey: undefined,
    matchText: undefined
  }
}

function normalizeTriggerRows(rows: WorkflowTemplateTrigger[]): WorkflowTemplateTrigger[] {
  return rows.map((trigger) => ({
    id: trigger.id,
    type: trigger.type,
    enabled: trigger.enabled,
    executionMode: trigger.executionMode,
    eventKey: trigger.eventKey.trim(),
    sourceKey: trigger.sourceKey?.trim() || undefined,
    matchText: trigger.matchText?.trim() || undefined
  }))
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

function uniqueItems(values: Array<string | undefined | null>): string[] {
  const seen = new Set<string>()
  const unique: string[] = []

  for (const value of values) {
    const normalized = (value || "").trim()
    if (!normalized || seen.has(normalized)) {
      continue
    }
    seen.add(normalized)
    unique.push(normalized)
  }

  return unique
}

function extractContentText(content: unknown): string {
  if (typeof content === "string") {
    return content.trim()
  }
  if (!Array.isArray(content)) {
    return ""
  }

  return content
    .map((part) => {
      if (typeof part === "string") {
        return part
      }
      if (!part || typeof part !== "object") {
        return ""
      }
      const text = (part as { text?: unknown }).text
      return typeof text === "string" ? text : ""
    })
    .join(" ")
    .trim()
}

function normalizeHistoryMessages(history: unknown[]): HistoryMessage[] {
  if (history.length === 0) {
    return []
  }

  const latest = history[0] as {
    checkpoint?: {
      channel_values?: {
        messages?: Array<{
          _getType?: () => string
          type?: string
          content?: unknown
        }>
      }
    }
  }

  const rawMessages = latest.checkpoint?.channel_values?.messages
  if (!Array.isArray(rawMessages)) {
    return []
  }

  return rawMessages
    .map((message): HistoryMessage | null => {
      const resolvedType =
        typeof message._getType === "function" ? message._getType() : message.type || "ai"

      const role: HistoryMessage["role"] =
        resolvedType === "human"
          ? "user"
          : resolvedType === "system"
            ? "system"
            : resolvedType === "tool"
              ? "tool"
              : "assistant"

      const content = extractContentText(message.content)
      if (!content) {
        return null
      }

      return { role, content }
    })
    .filter((message): message is HistoryMessage => !!message)
}

function inferConnectorKey(toolName: string | undefined): string | undefined {
  if (!toolName) {
    return undefined
  }

  const normalized = toolName.toLowerCase()
  if (normalized.includes("slack")) return "slack"
  if (normalized.includes("discord")) return "discord"
  if (normalized.includes("telegram")) return "telegram"
  if (normalized.includes("github")) return "github"
  if (normalized.includes("gmail") || normalized.includes("email")) return "email"
  if (normalized.includes("x_") || normalized.includes("twitter")) return "x"
  if (normalized.includes("webhook")) return "webhook"
  if (normalized.includes("notion")) return "notion"
  if (normalized.includes("jira")) return "jira"
  return undefined
}

function inferExpectedArtifacts(events: TimelineEvent[]): string[] {
  const artifactCandidates = events
    .filter((event) => event.eventType === "tool_call")
    .map((event) => event.payload as { args?: unknown })
    .map((payload) => payload.args)
    .filter((args): args is Record<string, unknown> => !!args && typeof args === "object")
    .flatMap((args) => {
      const single = args.file_path
      const many = args.file_paths
      const values: string[] = []

      if (typeof single === "string") {
        values.push(single)
      }
      if (Array.isArray(many)) {
        values.push(...many.filter((item): item is string => typeof item === "string"))
      }
      return values
    })

  return uniqueItems(artifactCandidates).slice(0, MAX_EXPECTED_ARTIFACTS)
}

function inferPolicyAction(toolName: string): "read" | "write" | "exec" | "post" {
  const normalized = toolName.toLowerCase()

  if (
    normalized.includes("post") ||
    normalized.includes("tweet") ||
    normalized.includes("publish")
  ) {
    return "post"
  }
  if (
    normalized.includes("exec") ||
    normalized.includes("shell") ||
    normalized.includes("command")
  ) {
    return "exec"
  }
  if (
    normalized.includes("write") ||
    normalized.includes("edit") ||
    normalized.includes("create") ||
    normalized.includes("delete")
  ) {
    return "write"
  }
  return "read"
}

function inferPolicyDefaults(events: TimelineEvent[]): WorkflowTemplatePolicyDefault[] {
  const approvals = events.filter((event) => event.eventType === "approval_required")
  const seen = new Set<string>()

  return approvals
    .map((event) => {
      const toolName = event.toolName?.trim() || "tool"
      const connectorKey = inferConnectorKey(toolName)
      const resourceType = connectorKey ? "connector" : "tool"
      const resourceKey = connectorKey || toolName
      const action = inferPolicyAction(toolName)
      const dedupeKey = `${event.sourceAgentId || "none"}:${resourceType}:${resourceKey}:${action}`

      if (seen.has(dedupeKey)) {
        return null
      }
      seen.add(dedupeKey)

      return {
        agentId: event.sourceAgentId,
        resourceType,
        resourceKey,
        action,
        scope: "session",
        decision: "ask"
      } as WorkflowTemplatePolicyDefault
    })
    .filter((rule): rule is WorkflowTemplatePolicyDefault => !!rule)
}

function deriveTemplateName(thread: Thread): string {
  const base = thread.title?.trim() || `Session ${thread.thread_id.slice(0, 8)}`
  return `${base} Template`
}

function normalizeDateValue(value: Date | string | number | undefined): number {
  if (value instanceof Date) {
    return value.getTime()
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return 0
}

function getTemplateIdFromThread(thread: Thread): string | null {
  const metadata = (thread.metadata || {}) as Record<string, unknown>
  const templateId = metadata.templateId
  return typeof templateId === "string" && templateId.trim().length > 0 ? templateId : null
}

function formatRunTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "Unknown time"
  }
  return new Date(timestamp).toLocaleString()
}

const WEEKDAY_LABELS: Record<string, string> = {
  MO: "Mon",
  TU: "Tue",
  WE: "Wed",
  TH: "Thu",
  FR: "Fri",
  SA: "Sat",
  SU: "Sun"
}

interface SchedulePreset {
  label: string
  rrule: string
  enabled?: boolean
}

const SCHEDULE_PRESETS: SchedulePreset[] = [
  { label: "Hourly", rrule: "FREQ=HOURLY;INTERVAL=1", enabled: true },
  { label: "Every 4h", rrule: "FREQ=HOURLY;INTERVAL=4", enabled: true },
  {
    label: "Weekdays 09:00",
    rrule: "FREQ=WEEKLY;BYDAY=MO,TU,WE,TH,FR;BYHOUR=9;BYMINUTE=0",
    enabled: true
  },
  {
    label: "Mon/Wed/Fri 14:30",
    rrule: "FREQ=WEEKLY;BYDAY=MO,WE,FR;BYHOUR=14;BYMINUTE=30",
    enabled: true
  }
]

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`
}

function formatTemplateScheduleSummary(
  enabled: boolean,
  rrule?: string,
  timezone?: string
): string {
  const timezoneSuffix = timezone?.trim() ? ` (${timezone.trim()})` : ""
  if (!rrule || !rrule.trim()) {
    return enabled ? `Enabled${timezoneSuffix}` : `Draft${timezoneSuffix}`
  }

  const tokens = parseRruleTokens(rrule)
  const freq = tokens.FREQ
  if (freq === "HOURLY") {
    const interval = Number(tokens.INTERVAL || "1")
    const hourlyLabel =
      Number.isFinite(interval) && interval > 1 ? `Every ${interval} hours` : "Hourly"
    return `${hourlyLabel}${timezoneSuffix}`
  }

  if (freq === "WEEKLY") {
    const byDay = (tokens.BYDAY || "")
      .split(",")
      .map((value) => value.trim().toUpperCase())
      .filter((value) => value.length > 0)
      .map((value) => WEEKDAY_LABELS[value] || value)
    const byHour = Number(tokens.BYHOUR)
    const byMinute = Number(tokens.BYMINUTE || "0")
    const dayLabel = byDay.length > 0 ? ` on ${byDay.join(", ")}` : ""
    const timeLabel =
      Number.isFinite(byHour) && byHour >= 0
        ? ` at ${pad2(byHour)}:${pad2(Number.isFinite(byMinute) && byMinute >= 0 ? byMinute : 0)}`
        : ""
    return `Weekly${dayLabel}${timeLabel}${timezoneSuffix}`
  }

  return `${enabled ? "Enabled" : "Draft"}: ${rrule}${timezoneSuffix}`
}

function formatTemplateScheduleNextRun(rrule?: string, timezone?: string): string | null {
  const trimmedRrule = rrule?.trim()
  if (!trimmedRrule) {
    return null
  }

  const resolvedTimezone =
    timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  const nextRunTimestamp = getNextTemplateScheduleRunTimestamp(trimmedRrule, resolvedTimezone)
  if (!nextRunTimestamp) {
    return null
  }

  const formatted = new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: resolvedTimezone
  }).format(new Date(nextRunTimestamp))

  const freq = parseRruleTokens(trimmedRrule).FREQ
  if (freq === "HOURLY") {
    return `Next run (estimated): ${formatted}`
  }
  return `Next run: ${formatted}`
}

function getRunStatusBadgeVariant(
  status: Thread["status"]
): "outline" | "info" | "warning" | "critical" {
  if (status === "busy") {
    return "info"
  }
  if (status === "interrupted") {
    return "warning"
  }
  if (status === "error") {
    return "critical"
  }
  return "outline"
}

function formatRunStatusLabel(status: Thread["status"]): string {
  if (status === "busy") {
    return "Running"
  }
  if (status === "interrupted") {
    return "Interrupted"
  }
  if (status === "error") {
    return "Error"
  }
  return "Idle"
}

function getScheduleRunStatusBadgeVariant(
  status: WorkflowTemplateScheduleRun["status"]
): "outline" | "info" | "warning" | "critical" {
  if (status === "started") {
    return "info"
  }
  if (status === "blocked") {
    return "warning"
  }
  if (status === "error") {
    return "critical"
  }
  return "outline"
}

function formatScheduleRunStatusLabel(status: WorkflowTemplateScheduleRun["status"]): string {
  if (status === "started") {
    return "Started"
  }
  if (status === "blocked") {
    return "Blocked"
  }
  if (status === "error") {
    return "Error"
  }
  return "Pending"
}

function groupScheduleRunsByTemplate(
  runs: WorkflowTemplateScheduleRun[]
): Record<string, WorkflowTemplateScheduleRun[]> {
  const grouped: Record<string, WorkflowTemplateScheduleRun[]> = {}
  for (const run of runs) {
    if (!grouped[run.templateId]) {
      grouped[run.templateId] = []
    }
    grouped[run.templateId].push(run)
  }

  for (const runList of Object.values(grouped)) {
    runList.sort(
      (left, right) => normalizeDateValue(right.updatedAt) - normalizeDateValue(left.updatedAt)
    )
  }
  return grouped
}

export function TemplatesView(): React.JSX.Element {
  const {
    agents,
    threads,
    currentThreadId,
    loadAgents,
    loadThreads,
    selectThread,
    selectedTemplateId,
    setSelectedTemplateId
  } = useAppStore()
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [scheduleRunsByTemplateId, setScheduleRunsByTemplateId] = useState<
    Record<string, WorkflowTemplateScheduleRun[]>
  >({})
  const [status, setStatus] = useState<string | null>(null)
  const [runSummaries, setRunSummaries] = useState<Record<string, string>>({})
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)

  const [sourceThreadId, setSourceThreadId] = useState("")
  const [deriveSummary, setDeriveSummary] = useState<SessionDeriveSummary | null>(null)

  const [name, setName] = useState("")
  const [description, setDescription] = useState("")
  const [starterPrompt, setStarterPrompt] = useState("")
  const [agentIds, setAgentIds] = useState("")
  const [requiredConnectors, setRequiredConnectors] = useState("")
  const [expectedArtifacts, setExpectedArtifacts] = useState("")
  const [tags, setTags] = useState("")
  const [defaultSpeakerType, setDefaultSpeakerType] = useState<"orchestrator" | "agent">(
    "orchestrator"
  )
  const [defaultSpeakerAgentId, setDefaultSpeakerAgentId] = useState("")
  const [defaultModelId, setDefaultModelId] = useState("")
  const [memorySeedJson, setMemorySeedJson] = useState("")
  const [policyDefaultsJson, setPolicyDefaultsJson] = useState("")
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleRrule, setScheduleRrule] = useState("")
  const detectedTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  )
  const [scheduleTimezone, setScheduleTimezone] = useState(detectedTimezone)
  const [triggerRows, setTriggerRows] = useState<WorkflowTemplateTrigger[]>([])
  const [simulationSelection, setSimulationSelection] = useState("")
  const [simulationThreadId, setSimulationThreadId] = useState("")
  const [simulationEventType, setSimulationEventType] = useState<"tool_call" | "tool_result">(
    "tool_result"
  )
  const [simulationEventKey, setSimulationEventKey] = useState("")
  const [simulationSourceKey, setSimulationSourceKey] = useState("")
  const [simulationSummary, setSimulationSummary] = useState("")
  const [simulationPayloadJson, setSimulationPayloadJson] = useState("{}")
  const [simulatingTrigger, setSimulatingTrigger] = useState(false)
  const [bundleJson, setBundleJson] = useState("")
  const [bundleFormat, setBundleFormat] = useState<"json" | "yaml">("json")
  const [showOnlyWithRuns, setShowOnlyWithRuns] = useState(false)

  const workspaceId = useMemo(() => agents[0]?.workspaceId || DEFAULT_WORKSPACE_ID, [agents])
  const activeSourceThreadId = sourceThreadId || threads[0]?.thread_id || ""
  const sourceThread = useMemo(
    () => threads.find((thread) => thread.thread_id === activeSourceThreadId) || null,
    [threads, activeSourceThreadId]
  )
  const templateRunsById = useMemo(() => {
    const byTemplate = new Map<string, TemplateRunRef[]>()

    for (const thread of threads) {
      const templateId = getTemplateIdFromThread(thread)
      if (!templateId) {
        continue
      }

      const runs = byTemplate.get(templateId) || []
      runs.push({
        threadId: thread.thread_id,
        title: thread.title || thread.thread_id.slice(0, 8),
        updatedAtMs: normalizeDateValue(thread.updated_at),
        status: thread.status
      })
      byTemplate.set(templateId, runs)
    }

    for (const runs of byTemplate.values()) {
      runs.sort((left, right) => right.updatedAtMs - left.updatedAtMs)
    }

    return byTemplate
  }, [threads])
  const visibleTemplates = useMemo(() => {
    if (!showOnlyWithRuns) {
      return templates
    }
    return templates.filter((template) => (templateRunsById.get(template.id) || []).length > 0)
  }, [showOnlyWithRuns, templateRunsById, templates])
  const externalTriggerOptions = useMemo<ExternalTriggerOption[]>(() => {
    const options: ExternalTriggerOption[] = []

    for (const template of templates) {
      for (const trigger of template.triggers) {
        const triggerType = toExternalTriggerType(trigger.type)
        if (!triggerType) {
          continue
        }
        options.push({
          key: `${template.id}:${trigger.id}`,
          templateId: template.id,
          templateName: template.name,
          triggerId: trigger.id,
          triggerType,
          eventKey: trigger.eventKey,
          sourceKey: trigger.sourceKey
        })
      }
    }

    return options
  }, [templates])
  const selectedExternalTrigger = useMemo(
    () => externalTriggerOptions.find((option) => option.key === simulationSelection) || null,
    [externalTriggerOptions, simulationSelection]
  )
  const editingTemplate = useMemo(
    () => templates.find((template) => template.id === editingTemplateId) || null,
    [editingTemplateId, templates]
  )
  const formScheduleNextRunPreview = useMemo(
    () => formatTemplateScheduleNextRun(scheduleRrule, scheduleTimezone || detectedTimezone),
    [detectedTimezone, scheduleRrule, scheduleTimezone]
  )

  const resetTemplateForm = useCallback(() => {
    setName("")
    setDescription("")
    setStarterPrompt("")
    setAgentIds("")
    setRequiredConnectors("")
    setExpectedArtifacts("")
    setTags("")
    setDefaultSpeakerType("orchestrator")
    setDefaultSpeakerAgentId("")
    setDefaultModelId("")
    setMemorySeedJson("")
    setPolicyDefaultsJson("")
    setScheduleEnabled(false)
    setScheduleRrule("")
    setScheduleTimezone(detectedTimezone)
    setTriggerRows([])
    setEditingTemplateId(null)
    setDeriveSummary(null)
  }, [detectedTimezone])

  useEffect(() => {
    const latestRunThreadIds = visibleTemplates
      .map((template) => (templateRunsById.get(template.id) || [])[0]?.threadId)
      .filter((threadId): threadId is string => !!threadId)
      .filter((threadId) => !runSummaries[threadId])

    if (latestRunThreadIds.length === 0) {
      return
    }

    let cancelled = false
    void Promise.all(
      latestRunThreadIds.map(async (threadId) => {
        try {
          const events = await window.api.timeline.list(threadId, 120)
          const summary = events.find(
            (event) => event.eventType === "tool_result" && event.toolName === "template:run"
          )?.summary
          return { threadId, summary: summary || "" }
        } catch {
          return { threadId, summary: "" }
        }
      })
    ).then((results) => {
      if (cancelled) {
        return
      }

      setRunSummaries((previous) => {
        const next = { ...previous }
        for (const result of results) {
          next[result.threadId] = result.summary
        }
        return next
      })
    })

    return () => {
      cancelled = true
    }
  }, [runSummaries, templateRunsById, visibleTemplates])

  const loadTemplates = useCallback(async () => {
    const [loadedTemplates, scheduleRuns] = await Promise.all([
      window.api.templates.list(workspaceId),
      window.api.templates.listScheduleRuns({ workspaceId, limit: 300 })
    ])
    setTemplates(loadedTemplates)
    setScheduleRunsByTemplateId(groupScheduleRunsByTemplate(scheduleRuns))
  }, [workspaceId])

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  useEffect(() => {
    let cancelled = false
    Promise.all([
      window.api.templates.list(workspaceId),
      window.api.templates.listScheduleRuns({ workspaceId, limit: 300 })
    ])
      .then(([loadedTemplates, scheduleRuns]) => {
        if (!cancelled) {
          setTemplates(loadedTemplates)
          setScheduleRunsByTemplateId(groupScheduleRunsByTemplate(scheduleRuns))
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setStatus(
            `Failed to load templates: ${error instanceof Error ? error.message : "Unknown error"}`
          )
        }
      })

    return () => {
      cancelled = true
    }
  }, [workspaceId])

  const deriveTemplateFromSession = async (): Promise<void> => {
    if (!activeSourceThreadId) {
      setStatus("Choose a session to derive a template from.")
      return
    }

    setStatus("Deriving template draft from session...")
    try {
      const [thread, history, timeline] = await Promise.all([
        window.api.threads.get(activeSourceThreadId),
        window.api.threads.getHistory(activeSourceThreadId),
        window.api.timeline.list(activeSourceThreadId, 400)
      ])

      if (!thread) {
        setStatus("Selected session no longer exists.")
        return
      }

      const metadata = (thread.metadata || {}) as Record<string, unknown>
      const historyMessages = normalizeHistoryMessages(history)
      const firstUserMessage = historyMessages.find((message) => message.role === "user")

      const metadataStarterPrompt =
        typeof metadata.templateStarterPrompt === "string"
          ? metadata.templateStarterPrompt.trim()
          : ""
      const starterPrompts = uniqueItems([
        metadataStarterPrompt,
        firstUserMessage?.content.slice(0, MAX_STARTER_PROMPT_LENGTH)
      ])

      const sessionAgentIds = uniqueItems([
        typeof metadata.speakerAgentId === "string" ? metadata.speakerAgentId : undefined,
        ...timeline.map((event) => event.sourceAgentId),
        ...timeline.map((event) => event.targetAgentId)
      ])

      const connectorKeys = uniqueItems(timeline.map((event) => inferConnectorKey(event.toolName)))
      const expected = inferExpectedArtifacts(timeline)
      const policyDefaults = inferPolicyDefaults(timeline)

      const derivedTags = uniqueItems([
        ...connectorKeys.map((key) => `connector:${key}`),
        timeline.some((event) => event.eventType === "subagent_started") ? "delegation" : undefined,
        timeline.some((event) => event.eventType === "approval_required") ? "approval" : undefined
      ])

      const defaultSpeakerType =
        metadata.speakerType === "agent" &&
        typeof metadata.speakerAgentId === "string" &&
        metadata.speakerAgentId.trim().length > 0
          ? "agent"
          : "orchestrator"

      const defaultSpeakerAgentId =
        defaultSpeakerType === "agent" && typeof metadata.speakerAgentId === "string"
          ? metadata.speakerAgentId
          : ""

      const modelFromMetadata =
        typeof metadata.model === "string" && metadata.model.trim().length > 0 ? metadata.model : ""

      const summarySeed = thread.title || thread.thread_id.slice(0, 8)
      const sessionSummary = firstUserMessage?.content
        ? `Derived from session "${summarySeed}". Seed task: ${firstUserMessage.content.slice(0, 160)}`
        : `Derived from session "${summarySeed}".`

      const memoryDefaults = starterPrompts.length
        ? {
            seedEntries: [
              {
                scope: "session" as const,
                title: "Template context",
                content: starterPrompts[0],
                tags: ["template-seed", "derived-session"]
              }
            ]
          }
        : {}

      setName(deriveTemplateName(thread))
      setDescription(sessionSummary)
      setStarterPrompt(starterPrompts.join("\n"))
      setAgentIds(sessionAgentIds.join(", "))
      setRequiredConnectors(connectorKeys.join(", "))
      setExpectedArtifacts(expected.join(", "))
      setTags(derivedTags.join(", "))
      setDefaultSpeakerType(defaultSpeakerType)
      setDefaultSpeakerAgentId(defaultSpeakerAgentId)
      setDefaultModelId(modelFromMetadata)
      setMemorySeedJson(
        Object.keys(memoryDefaults).length > 0 ? JSON.stringify(memoryDefaults, null, 2) : ""
      )
      setPolicyDefaultsJson(
        policyDefaults.length > 0 ? JSON.stringify(policyDefaults, null, 2) : ""
      )
      setEditingTemplateId(null)
      setScheduleEnabled(false)
      setScheduleRrule("")
      setScheduleTimezone(detectedTimezone)
      setTriggerRows([])
      setDeriveSummary({
        messageCount: historyMessages.length,
        timelineCount: timeline.length,
        connectorCount: connectorKeys.length,
        artifactCount: expected.length,
        policyCount: policyDefaults.length
      })
      setStatus(`Template draft generated from "${summarySeed}".`)
    } catch (error) {
      setStatus(
        `Failed to derive template: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  const beginEditingTemplate = useCallback(
    (template: WorkflowTemplate): void => {
      setEditingTemplateId(template.id)
      setDeriveSummary(null)
      setName(template.name)
      setDescription(template.description || "")
      setStarterPrompt(template.starterPrompts.join("\n"))
      setAgentIds(template.agentIds.join(", "))
      setRequiredConnectors(template.requiredConnectorKeys.join(", "))
      setExpectedArtifacts(template.expectedArtifacts.join(", "))
      setTags(template.tags.join(", "))
      setDefaultSpeakerType(template.defaultSpeakerType)
      setDefaultSpeakerAgentId(template.defaultSpeakerAgentId || "")
      setDefaultModelId(template.defaultModelId || "")
      setMemorySeedJson(
        Object.keys(template.memoryDefaults).length > 0
          ? JSON.stringify(template.memoryDefaults, null, 2)
          : ""
      )
      setPolicyDefaultsJson(
        template.policyDefaults.length > 0 ? JSON.stringify(template.policyDefaults, null, 2) : ""
      )
      setScheduleEnabled(template.schedule?.enabled ?? false)
      setScheduleRrule(template.schedule?.rrule || "")
      setScheduleTimezone(template.schedule?.timezone || detectedTimezone)
      setTriggerRows(template.triggers)
      setStatus(`Editing template "${template.name}".`)
    },
    [detectedTimezone]
  )

  const cancelEditingTemplate = (): void => {
    resetTemplateForm()
    setStatus("Edit canceled.")
  }

  useEffect(() => {
    if (!selectedTemplateId) {
      return
    }

    const target = templates.find((template) => template.id === selectedTemplateId)
    if (!target) {
      return
    }

    beginEditingTemplate(target)
    setSelectedTemplateId(null)
  }, [beginEditingTemplate, selectedTemplateId, setSelectedTemplateId, templates])

  useEffect(() => {
    if (!simulationThreadId && currentThreadId) {
      setSimulationThreadId(currentThreadId)
    }
  }, [currentThreadId, simulationThreadId])

  useEffect(() => {
    if (externalTriggerOptions.length === 0) {
      setSimulationSelection("")
      setSimulationEventKey("")
      setSimulationSourceKey("")
      return
    }

    const hasSelection = externalTriggerOptions.some((option) => option.key === simulationSelection)
    const nextSelection = hasSelection ? simulationSelection : externalTriggerOptions[0].key
    const selected =
      externalTriggerOptions.find((option) => option.key === nextSelection) ||
      externalTriggerOptions[0]

    if (!hasSelection) {
      setSimulationSelection(selected.key)
      setSimulationEventKey(selected.eventKey)
      setSimulationSourceKey(selected.sourceKey || "")
      if (!simulationSummary.trim()) {
        setSimulationSummary(
          `Manual ${selected.triggerType} simulation for template "${selected.templateName}".`
        )
      }
    }
  }, [externalTriggerOptions, simulationSelection, simulationSummary])

  const applySchedulePreset = (preset: SchedulePreset): void => {
    setScheduleRrule(preset.rrule)
    if (preset.enabled) {
      setScheduleEnabled(true)
    }
  }

  const selectSimulationTrigger = (selectionKey: string): void => {
    setSimulationSelection(selectionKey)
    const selected = externalTriggerOptions.find((option) => option.key === selectionKey)
    if (!selected) {
      return
    }
    setSimulationEventKey(selected.eventKey)
    setSimulationSourceKey(selected.sourceKey || "")
  }

  const addTriggerRow = (): void => {
    setTriggerRows((previous) => [...previous, createEmptyTrigger()])
  }

  const removeTriggerRow = (triggerId: string): void => {
    setTriggerRows((previous) => previous.filter((trigger) => trigger.id !== triggerId))
  }

  const updateTriggerRow = (triggerId: string, updates: Partial<WorkflowTemplateTrigger>): void => {
    setTriggerRows((previous) =>
      previous.map((trigger) => (trigger.id === triggerId ? { ...trigger, ...updates } : trigger))
    )
  }

  const simulateExternalTrigger = async (): Promise<void> => {
    if (!selectedExternalTrigger) {
      setStatus("Select a connector/webhook trigger to simulate.")
      return
    }
    if (!simulationThreadId.trim()) {
      setStatus("Choose a target thread for trigger simulation.")
      return
    }

    const eventKey = simulationEventKey.trim() || selectedExternalTrigger.eventKey
    if (!eventKey) {
      setStatus("Simulation event key is required.")
      return
    }

    let payload: Record<string, unknown> = {}
    if (simulationPayloadJson.trim()) {
      try {
        const parsed = JSON.parse(simulationPayloadJson)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setStatus("Simulation payload must be a JSON object.")
          return
        }
        payload = parsed as Record<string, unknown>
      } catch (error) {
        setStatus(
          `Invalid simulation payload JSON: ${error instanceof Error ? error.message : "Unknown error"}`
        )
        return
      }
    }

    setSimulatingTrigger(true)
    setStatus(
      `Injecting ${selectedExternalTrigger.triggerType} trigger event for "${selectedExternalTrigger.templateName}"...`
    )
    try {
      const injected = await window.api.timeline.ingestTriggerEvent({
        threadId: simulationThreadId.trim(),
        workspaceId,
        triggerType: selectedExternalTrigger.triggerType,
        eventType: simulationEventType,
        eventKey,
        sourceKey: simulationSourceKey.trim() || selectedExternalTrigger.sourceKey || undefined,
        summary: simulationSummary.trim() || undefined,
        payload: {
          ...payload,
          templateId: selectedExternalTrigger.templateId,
          triggerId: selectedExternalTrigger.triggerId,
          simulatedBy: "templates-view"
        }
      })
      await loadThreads()
      setStatus(
        `Trigger event injected (${injected.id.slice(0, 8)}). Check timeline for template matches/auto-run updates.`
      )
    } catch (error) {
      setStatus(
        `Failed to inject trigger event: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setSimulatingTrigger(false)
    }
  }

  const primeSimulationFromTemplate = (template: WorkflowTemplate): void => {
    const option = externalTriggerOptions.find((candidate) => candidate.templateId === template.id)
    if (!option) {
      setStatus(`Template "${template.name}" has no connector/webhook triggers to simulate.`)
      return
    }

    selectSimulationTrigger(option.key)
    if (!simulationThreadId && currentThreadId) {
      setSimulationThreadId(currentThreadId)
    }
    setSimulationSummary(`Manual ${option.triggerType} simulation for template "${template.name}".`)
    setStatus(`Simulator primed for "${template.name}" (${option.triggerType}:${option.eventKey}).`)
  }

  const createTemplate = async (): Promise<void> => {
    const templateName = name.trim()
    if (!templateName) {
      return
    }

    if (defaultSpeakerType === "agent" && !defaultSpeakerAgentId.trim()) {
      setStatus("Select a default agent speaker or switch to orchestrator.")
      return
    }

    if (scheduleEnabled && !scheduleRrule.trim()) {
      setStatus("Schedule is enabled but RRULE is empty.")
      return
    }

    const scheduleValidationError = validateTemplateScheduleRrule(scheduleRrule)
    if (scheduleValidationError) {
      setStatus(`Schedule RRULE error: ${scheduleValidationError}`)
      return
    }

    const normalizedTriggers = normalizeTriggerRows(triggerRows)
    if (normalizedTriggers.some((trigger) => !trigger.eventKey)) {
      setStatus("Each trigger requires an event key.")
      return
    }
    if (
      normalizedTriggers.some(
        (trigger) => trigger.executionMode === "auto_run" && trigger.type !== "timeline_event"
      )
    ) {
      setStatus("Auto-run is currently supported only for timeline_event triggers.")
      return
    }

    let memoryDefaults: WorkflowTemplate["memoryDefaults"] = {}
    let policyDefaults: WorkflowTemplate["policyDefaults"] = []

    try {
      if (memorySeedJson.trim()) {
        const parsed = JSON.parse(memorySeedJson)
        memoryDefaults =
          typeof parsed === "object" && parsed ? (parsed as WorkflowTemplate["memoryDefaults"]) : {}
      }
      if (policyDefaultsJson.trim()) {
        const parsed = JSON.parse(policyDefaultsJson)
        policyDefaults = Array.isArray(parsed) ? (parsed as WorkflowTemplate["policyDefaults"]) : []
      }
    } catch (error) {
      setStatus(
        `Invalid JSON in defaults: ${error instanceof Error ? error.message : "Unknown error"}`
      )
      return
    }

    const trimmedScheduleRrule = scheduleRrule.trim()
    const trimmedScheduleTimezone = scheduleTimezone.trim()
    const schedule =
      scheduleEnabled || trimmedScheduleRrule.length > 0
        ? {
            enabled: scheduleEnabled,
            rrule: trimmedScheduleRrule || undefined,
            timezone: trimmedScheduleTimezone || undefined
          }
        : undefined

    const templateUpdates = {
      name: templateName,
      description: description.trim(),
      starterPrompts: starterPrompt
        .split("\n")
        .map((value) => value.trim())
        .filter(Boolean),
      agentIds: splitCsv(agentIds),
      requiredConnectorKeys: splitCsv(requiredConnectors),
      expectedArtifacts: splitCsv(expectedArtifacts),
      tags: splitCsv(tags),
      defaultSpeakerType,
      defaultSpeakerAgentId:
        defaultSpeakerType === "agent" && defaultSpeakerAgentId ? defaultSpeakerAgentId : undefined,
      defaultModelId: defaultModelId.trim() || undefined,
      memoryDefaults,
      policyDefaults,
      triggers: normalizedTriggers
    }

    setStatus(editingTemplateId ? "Updating template..." : "Creating template...")
    try {
      if (editingTemplateId) {
        await window.api.templates.update(editingTemplateId, {
          ...templateUpdates,
          schedule
        })
      } else {
        await window.api.templates.create({
          ...templateUpdates,
          description: templateUpdates.description || undefined,
          workspaceId,
          schedule
        })
      }

      resetTemplateForm()
      setStatus(editingTemplateId ? "Template updated." : "Template created.")
      await loadTemplates()
    } catch (error) {
      setStatus(
        `Failed to save template: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  const deleteTemplate = async (templateId: string): Promise<void> => {
    setStatus("Deleting template...")
    try {
      await window.api.templates.delete(templateId)
      if (editingTemplateId === templateId) {
        resetTemplateForm()
      }
      setStatus("Template deleted.")
      await loadTemplates()
    } catch (error) {
      setStatus(
        `Failed to delete template: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  const runTemplate = async (template: WorkflowTemplate): Promise<void> => {
    setStatus(`Running template "${template.name}"...`)
    try {
      const result = await window.api.templates.run(template.id)

      if (result.status === "blocked") {
        const missing = result.missingConnectors?.join(", ") || "unspecified"
        setStatus(`Template blocked: missing enabled connectors (${missing}).`)
        return
      }

      await loadThreads()
      if (result.thread?.thread_id) {
        await selectThread(result.thread.thread_id)
      }

      const threadRef = result.thread?.thread_id?.slice(0, 8) || "unknown"
      setStatus(
        `Template "${template.name}" started as thread ${threadRef}. Applied ${result.appliedPolicies} policies and seeded ${result.seededMemoryEntries} memory entries.`
      )
    } catch (error) {
      setStatus(
        `Failed to run template: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  const openTemplateRunThread = async (threadId: string): Promise<void> => {
    await selectThread(threadId)
  }

  const copyAutomationDraft = async (
    template: WorkflowTemplate,
    latestRun?: TemplateRunRef
  ): Promise<void> => {
    try {
      const globalWorkspacePath = await window.api.workspace.get()
      const directiveDraft = await window.api.templates.buildAutomationDirective(template.id, {
        threadId: latestRun?.threadId,
        cwd: globalWorkspacePath || undefined
      })
      const payload = [
        directiveDraft.directive,
        "",
        JSON.stringify(
          {
            ...directiveDraft.draft,
            cwd: directiveDraft.cwd
          },
          null,
          2
        )
      ].join("\n")

      await navigator.clipboard.writeText(payload)
      setStatus(
        directiveDraft.usedFallbackCwd
          ? `Automation payload copied for "${template.name}" (using workspace ID fallback for cwd).`
          : `Automation payload copied for "${template.name}".`
      )
    } catch (error) {
      setStatus(
        `Failed to copy automation directive: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  const exportBundle = async (format: "json" | "yaml" = bundleFormat): Promise<void> => {
    setStatus(`Exporting template bundle (${format})...`)
    try {
      const bundle = await window.api.templates.exportBundle(workspaceId)
      const serialized = format === "yaml" ? stringifyYaml(bundle) : JSON.stringify(bundle, null, 2)
      setBundleJson(serialized)
      setBundleFormat(format)
      setStatus(`Template bundle exported (${format}).`)
    } catch (error) {
      setStatus(
        `Failed to export bundle: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  const importBundle = async (): Promise<void> => {
    if (!bundleJson.trim()) {
      return
    }

    setStatus(`Importing template bundle (${bundleFormat})...`)
    try {
      let parsed: unknown
      if (bundleFormat === "yaml") {
        parsed = parseYaml(bundleJson)
      } else {
        try {
          parsed = JSON.parse(bundleJson)
        } catch {
          parsed = parseYaml(bundleJson)
          setBundleFormat("yaml")
        }
      }
      const normalized = parsed as WorkflowTemplateExportBundle
      if (
        !normalized ||
        typeof normalized !== "object" ||
        !Array.isArray((normalized as { items?: unknown[] }).items)
      ) {
        throw new Error("Invalid template bundle format.")
      }
      await window.api.templates.importBundle(normalized)
      await loadTemplates()
      setStatus("Template bundle imported.")
    } catch (error) {
      setStatus(
        `Failed to import bundle: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  const copyBundle = async (): Promise<void> => {
    if (!bundleJson.trim()) {
      return
    }
    try {
      await navigator.clipboard.writeText(bundleJson)
      setStatus(`Bundle ${bundleFormat.toUpperCase()} copied to clipboard.`)
    } catch {
      setStatus("Clipboard copy failed.")
    }
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-border">
        <div className="border-b border-border px-4 py-3">
          <div className="text-section-header">WORKFLOW TEMPLATES</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Build reusable workflow packs with starter prompts, routing defaults, policies, and
            memory seeds.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 overflow-auto p-4 xl:grid-cols-[360px_1fr]">
          <div className="rounded-sm border border-border p-3">
            <div className="mb-3 rounded-sm border border-border/60 bg-background p-2.5">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Create From Session
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Auto-derive starter prompts, policies, connectors, and artifacts from an existing
                run.
              </div>
              <div className="mt-2 space-y-2">
                <select
                  value={activeSourceThreadId}
                  onChange={(event) => setSourceThreadId(event.target.value)}
                  className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                >
                  <option value="">Select session</option>
                  {threads.map((thread) => (
                    <option key={thread.thread_id} value={thread.thread_id}>
                      {thread.title || thread.thread_id.slice(0, 8)}
                    </option>
                  ))}
                </select>

                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 w-full"
                  onClick={deriveTemplateFromSession}
                  disabled={!activeSourceThreadId}
                >
                  <Sparkles className="mr-1 size-3.5" />
                  Derive Draft
                </Button>

                {sourceThread && (
                  <div className="rounded-sm border border-border/60 px-2 py-1.5 text-[11px] text-muted-foreground">
                    Source: {sourceThread.title || sourceThread.thread_id.slice(0, 8)}
                  </div>
                )}

                {deriveSummary && (
                  <div className="rounded-sm border border-border/60 bg-sidebar px-2 py-1.5 text-[11px] text-muted-foreground">
                    {deriveSummary.messageCount} messages, {deriveSummary.timelineCount} timeline
                    events, {deriveSummary.connectorCount} connectors, {deriveSummary.artifactCount}{" "}
                    artifacts, {deriveSummary.policyCount} policy defaults
                  </div>
                )}
              </div>
            </div>

            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              {editingTemplate ? "Edit Template" : "Create Template"}
            </div>
            {editingTemplate && (
              <div className="mb-2 rounded-sm border border-border/60 bg-sidebar px-2 py-1.5 text-[11px] text-muted-foreground">
                Editing: {editingTemplate.name}
                <Button
                  size="sm"
                  variant="outline"
                  className="ml-2 h-6 text-[10px]"
                  onClick={cancelEditingTemplate}
                >
                  Cancel
                </Button>
              </div>
            )}
            <div className="space-y-2">
              <input
                value={name}
                onChange={(event) => setName(event.target.value)}
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                placeholder="Template name"
              />
              <input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                placeholder="Description"
              />
              <textarea
                value={starterPrompt}
                onChange={(event) => setStarterPrompt(event.target.value)}
                className="h-20 w-full rounded-sm border border-input bg-background px-2 py-1 text-xs"
                placeholder="Starter prompt lines (one per line)"
              />
              <input
                value={agentIds}
                onChange={(event) => setAgentIds(event.target.value)}
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                placeholder="Agent IDs (csv)"
              />
              <input
                value={requiredConnectors}
                onChange={(event) => setRequiredConnectors(event.target.value)}
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                placeholder="Required connectors (csv)"
              />
              <input
                value={expectedArtifacts}
                onChange={(event) => setExpectedArtifacts(event.target.value)}
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                placeholder="Expected artifacts (csv)"
              />
              <input
                value={tags}
                onChange={(event) => setTags(event.target.value)}
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                placeholder="Tags (csv)"
              />

              <select
                value={defaultSpeakerType}
                onChange={(event) =>
                  setDefaultSpeakerType(event.target.value as "orchestrator" | "agent")
                }
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
              >
                <option value="orchestrator">Default speaker: orchestrator</option>
                <option value="agent">Default speaker: specific agent</option>
              </select>

              {defaultSpeakerType === "agent" && (
                <select
                  value={defaultSpeakerAgentId}
                  onChange={(event) => setDefaultSpeakerAgentId(event.target.value)}
                  className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                >
                  <option value="">Select agent</option>
                  {agents.map((agent) => (
                    <option key={agent.id} value={agent.id}>
                      {agent.name}
                    </option>
                  ))}
                </select>
              )}

              <input
                value={defaultModelId}
                onChange={(event) => setDefaultModelId(event.target.value)}
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                placeholder="Default model ID (optional)"
              />

              <textarea
                value={memorySeedJson}
                onChange={(event) => setMemorySeedJson(event.target.value)}
                className="h-20 w-full rounded-sm border border-input bg-background px-2 py-1 font-mono text-[11px]"
                placeholder='Memory defaults JSON (optional), e.g. {"seedEntries":[{"scope":"workspace","content":"..."}]}'
              />
              <textarea
                value={policyDefaultsJson}
                onChange={(event) => setPolicyDefaultsJson(event.target.value)}
                className="h-20 w-full rounded-sm border border-input bg-background px-2 py-1 font-mono text-[11px]"
                placeholder="Policy defaults JSON array (optional)"
              />
              <div className="rounded-sm border border-border/60 bg-sidebar px-2 py-2">
                <div className="mb-2 flex items-center justify-between">
                  <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                    Trigger Rules
                  </div>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    onClick={addTriggerRow}
                  >
                    <Plus className="mr-1 size-3" />
                    Add Trigger
                  </Button>
                </div>
                {triggerRows.length === 0 ? (
                  <div className="text-[11px] text-muted-foreground">No triggers configured.</div>
                ) : (
                  <div className="space-y-2">
                    {triggerRows.map((trigger) => (
                      <div
                        key={trigger.id}
                        className="rounded-sm border border-border bg-background p-2"
                      >
                        <div className="mb-2 flex items-center justify-between gap-2">
                          <label className="flex items-center gap-1 text-[11px] text-muted-foreground">
                            <input
                              type="checkbox"
                              checked={trigger.enabled}
                              onChange={(event) =>
                                updateTriggerRow(trigger.id, { enabled: event.target.checked })
                              }
                              className="size-3.5 rounded border border-input"
                            />
                            Enabled
                          </label>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-6 px-1.5 text-[10px]"
                            onClick={() => removeTriggerRow(trigger.id)}
                          >
                            <Trash2 className="size-3" />
                          </Button>
                        </div>
                        <select
                          value={trigger.type}
                          onChange={(event) => {
                            const nextType = event.target.value as WorkflowTemplateTrigger["type"]
                            const nextUpdates: Partial<WorkflowTemplateTrigger> = { type: nextType }
                            if (
                              nextType !== "timeline_event" &&
                              trigger.executionMode === "auto_run"
                            ) {
                              nextUpdates.executionMode = "notify"
                            }
                            updateTriggerRow(trigger.id, nextUpdates)
                          }}
                          className="mb-1 h-7 w-full rounded-sm border border-input bg-background px-2 text-[11px]"
                        >
                          {TRIGGER_TYPE_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        <select
                          value={trigger.executionMode}
                          onChange={(event) =>
                            updateTriggerRow(trigger.id, {
                              executionMode: event.target
                                .value as WorkflowTemplateTrigger["executionMode"]
                            })
                          }
                          className="mb-1 h-7 w-full rounded-sm border border-input bg-background px-2 text-[11px]"
                        >
                          {(trigger.type === "timeline_event"
                            ? TRIGGER_EXECUTION_MODE_OPTIONS
                            : TRIGGER_EXECUTION_MODE_OPTIONS.filter(
                                (option) => option.value === "notify"
                              )
                          ).map((option) => (
                            <option key={option.value} value={option.value}>
                              {option.label}
                            </option>
                          ))}
                        </select>
                        {trigger.type !== "timeline_event" && (
                          <div className="mb-1 text-[10px] text-muted-foreground">
                            Auto-run is only available for timeline triggers.
                          </div>
                        )}
                        <input
                          value={trigger.eventKey}
                          onChange={(event) =>
                            updateTriggerRow(trigger.id, { eventKey: event.target.value })
                          }
                          className="mb-1 h-7 w-full rounded-sm border border-input bg-background px-2 text-[11px]"
                          placeholder="Event key (e.g., tool_result)"
                        />
                        <input
                          value={trigger.sourceKey || ""}
                          onChange={(event) =>
                            updateTriggerRow(trigger.id, { sourceKey: event.target.value })
                          }
                          className="mb-1 h-7 w-full rounded-sm border border-input bg-background px-2 text-[11px]"
                          placeholder="Source key (optional, e.g., github)"
                        />
                        <input
                          value={trigger.matchText || ""}
                          onChange={(event) =>
                            updateTriggerRow(trigger.id, { matchText: event.target.value })
                          }
                          className="h-7 w-full rounded-sm border border-input bg-background px-2 text-[11px]"
                          placeholder="Match text contains (optional)"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 text-xs text-muted-foreground">
                <input
                  type="checkbox"
                  checked={scheduleEnabled}
                  onChange={(event) => setScheduleEnabled(event.target.checked)}
                  className="size-3.5 rounded border border-input"
                />
                Enable schedule metadata
              </label>
              <input
                value={scheduleRrule}
                onChange={(event) => setScheduleRrule(event.target.value)}
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                placeholder="Schedule RRULE (optional)"
              />
              <div className="flex flex-wrap gap-1">
                {SCHEDULE_PRESETS.map((preset) => (
                  <Button
                    key={preset.label}
                    size="sm"
                    variant="outline"
                    className="h-6 px-2 text-[10px]"
                    onClick={() => applySchedulePreset(preset)}
                  >
                    {preset.label}
                  </Button>
                ))}
              </div>
              <input
                value={scheduleTimezone}
                onChange={(event) => setScheduleTimezone(event.target.value)}
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                placeholder="Schedule timezone (optional)"
              />
              {(scheduleEnabled || scheduleRrule.trim()) && (
                <div className="rounded-sm border border-border/60 bg-sidebar px-2 py-1.5 text-[11px] text-muted-foreground">
                  {formatTemplateScheduleSummary(scheduleEnabled, scheduleRrule, scheduleTimezone)}
                  {formScheduleNextRunPreview && (
                    <div className="mt-1">{formScheduleNextRunPreview}</div>
                  )}
                </div>
              )}

              <Button size="sm" className="h-8 w-full" onClick={createTemplate}>
                {editingTemplate ? "Update template" : "Save template"}
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="rounded-sm border border-border/60 bg-sidebar p-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                External Trigger Simulator
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Inject connector/webhook trigger events into a thread to validate template matching.
              </div>
              {externalTriggerOptions.length === 0 ? (
                <div className="mt-2 rounded-sm border border-border/60 bg-background px-2 py-1.5 text-[11px] text-muted-foreground">
                  No connector/webhook triggers available in current templates.
                </div>
              ) : (
                <div className="mt-2 space-y-2">
                  <select
                    value={simulationSelection}
                    onChange={(event) => selectSimulationTrigger(event.target.value)}
                    className="h-7 w-full rounded-sm border border-input bg-background px-2 text-[11px]"
                  >
                    {externalTriggerOptions.map((option) => (
                      <option key={option.key} value={option.key}>
                        {option.templateName} - {option.triggerType}:{option.eventKey}
                      </option>
                    ))}
                  </select>
                  <select
                    value={simulationThreadId}
                    onChange={(event) => setSimulationThreadId(event.target.value)}
                    className="h-7 w-full rounded-sm border border-input bg-background px-2 text-[11px]"
                  >
                    <option value="">Select target thread</option>
                    {threads.map((thread) => (
                      <option key={thread.thread_id} value={thread.thread_id}>
                        {thread.title || thread.thread_id.slice(0, 8)}
                      </option>
                    ))}
                  </select>
                  <select
                    value={simulationEventType}
                    onChange={(event) =>
                      setSimulationEventType(event.target.value as "tool_call" | "tool_result")
                    }
                    className="h-7 w-full rounded-sm border border-input bg-background px-2 text-[11px]"
                  >
                    <option value="tool_result">Tool Result Event</option>
                    <option value="tool_call">Tool Call Event</option>
                  </select>
                  <input
                    value={simulationEventKey}
                    onChange={(event) => setSimulationEventKey(event.target.value)}
                    className="h-7 w-full rounded-sm border border-input bg-background px-2 text-[11px]"
                    placeholder="Event key"
                  />
                  <input
                    value={simulationSourceKey}
                    onChange={(event) => setSimulationSourceKey(event.target.value)}
                    className="h-7 w-full rounded-sm border border-input bg-background px-2 text-[11px]"
                    placeholder="Source key (optional)"
                  />
                  <input
                    value={simulationSummary}
                    onChange={(event) => setSimulationSummary(event.target.value)}
                    className="h-7 w-full rounded-sm border border-input bg-background px-2 text-[11px]"
                    placeholder="Summary (optional)"
                  />
                  <textarea
                    value={simulationPayloadJson}
                    onChange={(event) => setSimulationPayloadJson(event.target.value)}
                    className="h-16 w-full rounded-sm border border-input bg-background px-2 py-1 font-mono text-[11px]"
                    placeholder='Payload JSON object (optional), e.g. {"id":"evt_123"}'
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      className="h-7 text-xs"
                      onClick={() => {
                        void simulateExternalTrigger()
                      }}
                      disabled={simulatingTrigger}
                    >
                      {simulatingTrigger ? "Injecting..." : "Inject Trigger Event"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-7 text-xs"
                      onClick={() => setSimulationPayloadJson("{}")}
                      disabled={simulatingTrigger}
                    >
                      Reset Payload
                    </Button>
                  </div>
                </div>
              )}
            </div>

            <div className="mb-2 flex items-center justify-between">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Template Library
              </div>
              <Button
                size="sm"
                variant={showOnlyWithRuns ? "default" : "outline"}
                className="h-7 text-[11px]"
                onClick={() => setShowOnlyWithRuns((current) => !current)}
              >
                {showOnlyWithRuns ? "Showing Runs Only" : "Show Runs Only"}
              </Button>
            </div>

            {visibleTemplates.length === 0 ? (
              <div className="rounded-sm border border-border p-6 text-center text-sm text-muted-foreground">
                {templates.length === 0 ? "No templates yet." : "No templates match this filter."}
              </div>
            ) : (
              visibleTemplates.map((template) => {
                const runs = templateRunsById.get(template.id) || []
                const latestRun = runs[0]
                const scheduleRuns = scheduleRunsByTemplateId[template.id] || []
                const latestScheduledRun = scheduleRuns[0]
                const templateScheduleNextRunPreview = formatTemplateScheduleNextRun(
                  template.schedule?.rrule,
                  template.schedule?.timezone || detectedTimezone
                )

                return (
                  <div key={template.id} className="rounded-sm border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{template.name}</div>
                        {template.description && (
                          <div className="mt-1 text-xs text-muted-foreground">
                            {template.description}
                          </div>
                        )}
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Badge variant="outline">
                            {template.defaultSpeakerType === "agent"
                              ? "Agent routed"
                              : "Orchestrator"}
                          </Badge>
                          <span>
                            {template.requiredConnectorKeys.length} connector requirements
                          </span>
                          <span>{template.expectedArtifacts.length} expected artifacts</span>
                          <span>{template.triggers.length} triggers</span>
                          <span>{runs.length} runs</span>
                          <span>{scheduleRuns.length} scheduled runs</span>
                          {template.schedule?.enabled && <Badge variant="info">Scheduled</Badge>}
                          {!template.schedule?.enabled && template.schedule?.rrule && (
                            <Badge variant="outline">Schedule Draft</Badge>
                          )}
                        </div>
                        {template.schedule && (
                          <div className="mt-1 text-[11px] text-muted-foreground">
                            {formatTemplateScheduleSummary(
                              template.schedule.enabled,
                              template.schedule.rrule,
                              template.schedule.timezone
                            )}
                            {templateScheduleNextRunPreview && (
                              <div className="mt-1">{templateScheduleNextRunPreview}</div>
                            )}
                          </div>
                        )}
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-7"
                        onClick={() => {
                          void deleteTemplate(template.id)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>

                    {template.starterPrompts.length > 0 && (
                      <div className="mt-2 rounded-sm bg-background px-2 py-1.5 text-xs text-muted-foreground">
                        {template.starterPrompts[0]}
                      </div>
                    )}

                    {latestRun && (
                      <div className="mt-2 rounded-sm border border-border/60 bg-sidebar px-2 py-1.5 text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock3 className="size-3" />
                          Latest run: {formatRunTimestamp(latestRun.updatedAtMs)}
                        </div>
                        <div className="mt-1 truncate">Thread: {latestRun.title}</div>
                        <div className="mt-1">
                          <Badge variant={getRunStatusBadgeVariant(latestRun.status)}>
                            {formatRunStatusLabel(latestRun.status)}
                          </Badge>
                        </div>
                        {runSummaries[latestRun.threadId] && (
                          <div className="mt-1 line-clamp-2">
                            {runSummaries[latestRun.threadId]}
                          </div>
                        )}
                        <div className="mt-1 flex flex-wrap gap-1">
                          {runs.slice(0, 3).map((run) => (
                            <Button
                              key={run.threadId}
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px]"
                              onClick={() => {
                                void openTemplateRunThread(run.threadId)
                              }}
                            >
                              {run.title}
                            </Button>
                          ))}
                        </div>
                      </div>
                    )}

                    {latestScheduledRun && (
                      <div className="mt-2 rounded-sm border border-border/60 bg-sidebar px-2 py-1.5 text-[11px] text-muted-foreground">
                        <div className="flex items-center gap-1">
                          <Clock3 className="size-3" />
                          Latest scheduled run:{" "}
                          {formatRunTimestamp(normalizeDateValue(latestScheduledRun.updatedAt))}
                        </div>
                        <div className="mt-1">
                          <Badge
                            variant={getScheduleRunStatusBadgeVariant(latestScheduledRun.status)}
                          >
                            {formatScheduleRunStatusLabel(latestScheduledRun.status)}
                          </Badge>
                        </div>
                        {latestScheduledRun.missingConnectors.length > 0 && (
                          <div className="mt-1">
                            Missing connectors: {latestScheduledRun.missingConnectors.join(", ")}
                          </div>
                        )}
                        {latestScheduledRun.errorMessage && (
                          <div className="mt-1 line-clamp-2">{latestScheduledRun.errorMessage}</div>
                        )}
                        {latestScheduledRun.runThreadId && (
                          <div className="mt-1">
                            <Button
                              size="sm"
                              variant="outline"
                              className="h-6 text-[10px]"
                              onClick={() => {
                                const runThreadId = latestScheduledRun.runThreadId
                                if (runThreadId) {
                                  void openTemplateRunThread(runThreadId)
                                }
                              }}
                            >
                              Open scheduled run thread
                            </Button>
                          </div>
                        )}
                      </div>
                    )}

                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => {
                          void runTemplate(template)
                        }}
                      >
                        <Play className="mr-1 size-3.5" />
                        Run template
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="h-7 text-xs"
                        onClick={() => beginEditingTemplate(template)}
                      >
                        Edit
                      </Button>
                      {template.triggers.some((trigger) => trigger.type !== "timeline_event") && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => primeSimulationFromTemplate(template)}
                        >
                          Prime simulator
                        </Button>
                      )}
                      {template.schedule?.rrule && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            void copyAutomationDraft(template, latestRun)
                          }}
                        >
                          Copy Automation Directive
                        </Button>
                      )}
                      {latestRun && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            void openTemplateRunThread(latestRun.threadId)
                          }}
                        >
                          Open latest run
                        </Button>
                      )}
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </section>

      <aside className="flex w-[360px] flex-col overflow-auto bg-sidebar p-4">
        <div className="text-section-header">TEMPLATE PACKS</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Export/import reusable template bundles as JSON or YAML.
        </div>

        <div className="mt-3 flex gap-2">
          <Button
            size="sm"
            className="h-8 flex-1"
            onClick={() => {
              void exportBundle(bundleFormat)
            }}
          >
            <FileDown className="mr-1 size-3.5" />
            Export
          </Button>
          <Button size="sm" variant="outline" className="h-8 flex-1" onClick={importBundle}>
            <FileUp className="mr-1 size-3.5" />
            Import
          </Button>
        </div>

        <div className="mt-2">
          <label className="mb-1 block text-[11px] text-muted-foreground">Bundle Format</label>
          <select
            value={bundleFormat}
            onChange={(event) => setBundleFormat(event.target.value as "json" | "yaml")}
            className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
          >
            <option value="json">JSON</option>
            <option value="yaml">YAML</option>
          </select>
        </div>

        <textarea
          value={bundleJson}
          onChange={(event) => setBundleJson(event.target.value)}
          className="mt-3 h-80 w-full rounded-sm border border-input bg-background px-2 py-1 font-mono text-[11px]"
          placeholder="Exported bundle content appears here. Paste JSON or YAML to import."
        />

        <Button
          size="sm"
          variant="outline"
          className="mt-2 h-8"
          disabled={!bundleJson.trim()}
          onClick={copyBundle}
        >
          <Copy className="mr-1 size-3.5" />
          Copy
        </Button>

        {status && (
          <div className="mt-3 rounded-sm border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            {status}
          </div>
        )}
      </aside>
    </div>
  )
}
