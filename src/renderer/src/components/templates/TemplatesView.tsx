import { useCallback, useEffect, useMemo, useState } from "react"
import { ChevronDown, Clock3, Copy, FileDown, FileUp, Play, Plus, Trash2 } from "lucide-react"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/lib/store"
import { getNextTemplateScheduleRunTimestamp } from "../../../../shared/template-schedule-preview"
import {
  parseRruleTokens,
  validateTemplateScheduleRrule
} from "../../../../shared/template-schedule"
import { cn } from "@/lib/utils"
import type {
  Thread,
  WorkflowTemplate,
  WorkflowTemplateExportBundle,
  WorkflowTemplatePolicyDefault
} from "@/types"

const DEFAULT_WORKSPACE_ID = "default-workspace"

interface TemplateRunRef {
  threadId: string
  title: string
  updatedAtMs: number
  status: Thread["status"]
}

function splitCsv(value: string): string[] {
  return value
    .split(",")
    .map((i) => i.trim())
    .filter((i) => i.length > 0)
}

function normalizeDateValue(value: Date | string | number | undefined): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function getTemplateIdFromThread(thread: Thread): string | null {
  const metadata = (thread.metadata || {}) as Record<string, unknown>
  const templateId = metadata.templateId
  return typeof templateId === "string" && templateId.trim().length > 0 ? templateId : null
}

function formatRunTimestamp(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) return "Unknown"
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

function pad2(value: number): string {
  return value < 10 ? `0${value}` : `${value}`
}

function formatScheduleSummary(enabled: boolean, rrule?: string, timezone?: string): string {
  const tz = timezone?.trim() ? ` (${timezone.trim()})` : ""
  if (!rrule?.trim()) return enabled ? `Enabled${tz}` : `Draft${tz}`

  const tokens = parseRruleTokens(rrule)
  const freq = tokens.FREQ
  if (freq === "HOURLY") {
    const interval = Number(tokens.INTERVAL || "1")
    return (interval > 1 ? `Every ${interval}h` : "Hourly") + tz
  }

  if (freq === "WEEKLY") {
    const byDay = (tokens.BYDAY || "")
      .split(",")
      .map((v) => v.trim().toUpperCase())
      .filter(Boolean)
      .map((v) => WEEKDAY_LABELS[v] || v)
    const byHour = Number(tokens.BYHOUR)
    const byMinute = Number(tokens.BYMINUTE || "0")
    const dayLabel = byDay.length > 0 ? ` ${byDay.join(", ")}` : ""
    const timeLabel =
      Number.isFinite(byHour) && byHour >= 0
        ? ` at ${pad2(byHour)}:${pad2(Number.isFinite(byMinute) && byMinute >= 0 ? byMinute : 0)}`
        : ""
    return `Weekly${dayLabel}${timeLabel}${tz}`
  }

  return `${enabled ? "Enabled" : "Draft"}: ${rrule}${tz}`
}

function getNextRun(rrule?: string, timezone?: string): string | null {
  const r = rrule?.trim()
  if (!r) return null
  const tz = timezone?.trim() || Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"
  const next = getNextTemplateScheduleRunTimestamp(r, tz)
  if (!next) return null
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: tz
  }).format(new Date(next))
}

// Collapsible section for progressive disclosure
function Section({
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
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-background-interactive"
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

export function TemplatesView(): React.JSX.Element {
  const {
    agents,
    threads,
    loadAgents,
    loadThreads,
    selectThread,
    selectedTemplateId,
    setSelectedTemplateId
  } = useAppStore()
  const [templates, setTemplates] = useState<WorkflowTemplate[]>([])
  const [status, setStatus] = useState<string | null>(null)
  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null)

  // Form state - simplified
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
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [scheduleRrule, setScheduleRrule] = useState("")
  const [scheduleTimezone, setScheduleTimezone] = useState("")
  const [bundleJson, setBundleJson] = useState("")
  const [bundleFormat, setBundleFormat] = useState<"json" | "yaml">("json")

  const workspaceId = useMemo(() => agents[0]?.workspaceId || DEFAULT_WORKSPACE_ID, [agents])
  const detectedTimezone = useMemo(
    () => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC",
    []
  )

  const templateRunsById = useMemo(() => {
    const byTemplate = new Map<string, TemplateRunRef[]>()
    for (const thread of threads) {
      const templateId = getTemplateIdFromThread(thread)
      if (!templateId) continue
      const runs = byTemplate.get(templateId) || []
      runs.push({
        threadId: thread.thread_id,
        title: thread.title || thread.thread_id.slice(0, 8),
        updatedAtMs: normalizeDateValue(thread.updated_at),
        status: thread.status
      })
      byTemplate.set(templateId, runs)
    }
    for (const runs of byTemplate.values()) runs.sort((a, b) => b.updatedAtMs - a.updatedAtMs)
    return byTemplate
  }, [threads])

  const editingTemplate = useMemo(
    () => templates.find((t) => t.id === editingTemplateId) || null,
    [editingTemplateId, templates]
  )

  const formScheduleNextRun = useMemo(
    () => getNextRun(scheduleRrule, scheduleTimezone || detectedTimezone),
    [detectedTimezone, scheduleRrule, scheduleTimezone]
  )

  const resetForm = useCallback(() => {
    setName("")
    setDescription("")
    setStarterPrompt("")
    setAgentIds("")
    setRequiredConnectors("")
    setExpectedArtifacts("")
    setTags("")
    setDefaultSpeakerType("orchestrator")
    setDefaultSpeakerAgentId("")
    setScheduleEnabled(false)
    setScheduleRrule("")
    setScheduleTimezone(detectedTimezone)
    setEditingTemplateId(null)
  }, [detectedTimezone])

  const loadTemplates = useCallback(async () => {
    const loaded = await window.api.templates.list(workspaceId)
    setTemplates(loaded)
  }, [workspaceId])

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  useEffect(() => {
    loadTemplates().catch((err) =>
      setStatus(`Failed: ${err instanceof Error ? err.message : "Unknown"}`)
    )
  }, [loadTemplates])

  const beginEditingTemplate = useCallback(
    (template: WorkflowTemplate): void => {
      setEditingTemplateId(template.id)
      setName(template.name)
      setDescription(template.description || "")
      setStarterPrompt(template.starterPrompts.join("\n"))
      setAgentIds(template.agentIds.join(", "))
      setRequiredConnectors(template.requiredConnectorKeys.join(", "))
      setExpectedArtifacts(template.expectedArtifacts.join(", "))
      setTags(template.tags.join(", "))
      setDefaultSpeakerType(template.defaultSpeakerType)
      setDefaultSpeakerAgentId(template.defaultSpeakerAgentId || "")
      setScheduleEnabled(template.schedule?.enabled ?? false)
      setScheduleRrule(template.schedule?.rrule || "")
      setScheduleTimezone(template.schedule?.timezone || detectedTimezone)
      setStatus(`Editing: ${template.name}`)
    },
    [detectedTimezone]
  )

  useEffect(() => {
    if (!selectedTemplateId) return
    const target = templates.find((t) => t.id === selectedTemplateId)
    if (!target) return
    beginEditingTemplate(target)
    setSelectedTemplateId(null)
  }, [beginEditingTemplate, selectedTemplateId, setSelectedTemplateId, templates])

  const createOrUpdateTemplate = async (): Promise<void> => {
    const templateName = name.trim()
    if (!templateName) return

    if (defaultSpeakerType === "agent" && !defaultSpeakerAgentId.trim()) {
      setStatus("Select an agent speaker or switch to orchestrator.")
      return
    }

    const scheduleValidationError = validateTemplateScheduleRrule(scheduleRrule)
    if (scheduleValidationError) {
      setStatus(`Schedule error: ${scheduleValidationError}`)
      return
    }

    const schedule =
      scheduleEnabled || scheduleRrule.trim()
        ? {
            enabled: scheduleEnabled,
            rrule: scheduleRrule.trim() || undefined,
            timezone: scheduleTimezone.trim() || undefined
          }
        : undefined

    const payload = {
      name: templateName,
      description: description.trim(),
      starterPrompts: starterPrompt
        .split("\n")
        .map((v) => v.trim())
        .filter(Boolean),
      agentIds: splitCsv(agentIds),
      requiredConnectorKeys: splitCsv(requiredConnectors),
      expectedArtifacts: splitCsv(expectedArtifacts),
      tags: splitCsv(tags),
      defaultSpeakerType,
      defaultSpeakerAgentId:
        defaultSpeakerType === "agent" && defaultSpeakerAgentId ? defaultSpeakerAgentId : undefined,
      memoryDefaults: {} as WorkflowTemplate["memoryDefaults"],
      policyDefaults: [] as WorkflowTemplatePolicyDefault[],
      triggers: editingTemplate?.triggers || []
    }

    setStatus(editingTemplateId ? "Updating..." : "Creating...")
    try {
      if (editingTemplateId) {
        await window.api.templates.update(editingTemplateId, { ...payload, schedule })
      } else {
        await window.api.templates.create({
          ...payload,
          description: payload.description || undefined,
          workspaceId,
          schedule
        })
      }
      resetForm()
      setStatus(editingTemplateId ? "Updated." : "Created.")
      await loadTemplates()
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : "Unknown"}`)
    }
  }

  const deleteTemplate = async (templateId: string): Promise<void> => {
    setStatus("Deleting...")
    try {
      await window.api.templates.delete(templateId)
      if (editingTemplateId === templateId) resetForm()
      setStatus("Deleted.")
      await loadTemplates()
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : "Unknown"}`)
    }
  }

  const runTemplate = async (template: WorkflowTemplate): Promise<void> => {
    setStatus(`Running "${template.name}"...`)
    try {
      const result = await window.api.templates.run(template.id)
      if (result.status === "blocked") {
        setStatus(`Blocked: missing connectors (${result.missingConnectors?.join(", ") || "?"}).`)
        return
      }
      await loadThreads()
      if (result.thread?.thread_id) await selectThread(result.thread.thread_id)
      setStatus(`Started: ${result.thread?.thread_id?.slice(0, 8) || "unknown"}`)
    } catch (err) {
      setStatus(`Failed: ${err instanceof Error ? err.message : "Unknown"}`)
    }
  }

  const exportBundle = async (): Promise<void> => {
    setStatus("Exporting...")
    try {
      const bundle = await window.api.templates.exportBundle(workspaceId)
      const serialized =
        bundleFormat === "yaml" ? stringifyYaml(bundle) : JSON.stringify(bundle, null, 2)
      setBundleJson(serialized)
      setStatus("Exported.")
    } catch (err) {
      setStatus(`Export failed: ${err instanceof Error ? err.message : "Unknown"}`)
    }
  }

  const importBundle = async (): Promise<void> => {
    if (!bundleJson.trim()) return
    setStatus("Importing...")
    try {
      let parsed: unknown
      try {
        parsed = JSON.parse(bundleJson)
      } catch {
        parsed = parseYaml(bundleJson)
      }
      await window.api.templates.importBundle(parsed as WorkflowTemplateExportBundle)
      await loadTemplates()
      setStatus("Imported.")
    } catch (err) {
      setStatus(`Import failed: ${err instanceof Error ? err.message : "Unknown"}`)
    }
  }

  const copyBundle = async (): Promise<void> => {
    if (!bundleJson.trim()) return
    await navigator.clipboard.writeText(bundleJson)
    setStatus("Copied to clipboard.")
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* Main Content */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="border-b border-border/50 px-6 py-4">
          <h1 className="text-base font-medium">Templates</h1>
          <p className="mt-0.5 text-xs text-muted-foreground">Reusable workflow configurations</p>
        </div>

        <div className="flex flex-1 gap-6 overflow-hidden p-6">
          {/* Form Panel */}
          <div className="w-80 shrink-0 space-y-4 overflow-auto">
            <div className="rounded-lg border border-border/40 p-4">
              <h2 className="text-xs font-medium text-muted-foreground">
                {editingTemplate ? `Edit: ${editingTemplate.name}` : "New Template"}
              </h2>
              {editingTemplate && (
                <button
                  onClick={resetForm}
                  className="mt-1 text-[10px] text-primary hover:underline"
                >
                  Cancel editing
                </button>
              )}
              <div className="mt-3 space-y-3">
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  placeholder="Template name"
                />
                <input
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  placeholder="Description (optional)"
                />
                <textarea
                  value={starterPrompt}
                  onChange={(e) => setStarterPrompt(e.target.value)}
                  className="min-h-[80px] w-full rounded-md border border-border/60 bg-background p-3 text-sm"
                  placeholder="Starter prompts (one per line)"
                />
                <Button size="sm" className="w-full" onClick={() => void createOrUpdateTemplate()}>
                  {editingTemplate ? "Update" : "Create"} Template
                </Button>
              </div>
            </div>

            {/* Advanced Options - Collapsed */}
            <Section title="Agent & Routing">
              <div className="space-y-3">
                <select
                  value={defaultSpeakerType}
                  onChange={(e) =>
                    setDefaultSpeakerType(e.target.value as "orchestrator" | "agent")
                  }
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                >
                  <option value="orchestrator">Orchestrator</option>
                  <option value="agent">Specific Agent</option>
                </select>
                {defaultSpeakerType === "agent" && (
                  <select
                    value={defaultSpeakerAgentId}
                    onChange={(e) => setDefaultSpeakerAgentId(e.target.value)}
                    className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  >
                    <option value="">Select agent</option>
                    {agents.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.name}
                      </option>
                    ))}
                  </select>
                )}
                <input
                  value={agentIds}
                  onChange={(e) => setAgentIds(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  placeholder="Agent IDs (comma separated)"
                />
              </div>
            </Section>

            <Section title="Requirements">
              <div className="space-y-3">
                <input
                  value={requiredConnectors}
                  onChange={(e) => setRequiredConnectors(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  placeholder="Required connectors"
                />
                <input
                  value={expectedArtifacts}
                  onChange={(e) => setExpectedArtifacts(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  placeholder="Expected artifacts"
                />
                <input
                  value={tags}
                  onChange={(e) => setTags(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  placeholder="Tags"
                />
              </div>
            </Section>

            <Section title="Schedule">
              <div className="space-y-3">
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={scheduleEnabled}
                    onChange={(e) => setScheduleEnabled(e.target.checked)}
                    className="size-4 rounded"
                  />
                  Enable schedule
                </label>
                <input
                  value={scheduleRrule}
                  onChange={(e) => setScheduleRrule(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm font-mono"
                  placeholder="RRULE (e.g., FREQ=HOURLY;INTERVAL=4)"
                />
                <input
                  value={scheduleTimezone}
                  onChange={(e) => setScheduleTimezone(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  placeholder={`Timezone (default: ${detectedTimezone})`}
                />
                {formScheduleNextRun && (
                  <p className="text-xs text-muted-foreground">Next: {formScheduleNextRun}</p>
                )}
              </div>
            </Section>

            {status && <p className="text-xs text-muted-foreground">{status}</p>}
          </div>

          {/* Template List */}
          <div className="min-w-0 flex-1 overflow-auto">
            {templates.length === 0 ? (
              <div className="empty-state">
                <Plus className="empty-state-icon" />
                <p className="text-sm text-muted-foreground">No templates yet</p>
                <p className="mt-1 text-xs text-muted-foreground/60">
                  Create your first workflow template
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {templates.map((template) => {
                  const runs = templateRunsById.get(template.id) || []
                  const latestRun = runs[0]
                  const nextRun = getNextRun(
                    template.schedule?.rrule,
                    template.schedule?.timezone || detectedTimezone
                  )

                  return (
                    <div
                      key={template.id}
                      className="rounded-lg border border-border/40 bg-card/50 p-4 transition-colors hover:border-border"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          <h3 className="font-medium">{template.name}</h3>
                          {template.description && (
                            <p className="mt-0.5 text-sm text-muted-foreground">
                              {template.description}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Badge variant="outline" className="text-[10px]">
                              {template.defaultSpeakerType === "agent" ? "Agent" : "Orchestrator"}
                            </Badge>
                            {template.schedule?.enabled && (
                              <Badge variant="info" className="text-[10px]">
                                Scheduled
                              </Badge>
                            )}
                            {runs.length > 0 && (
                              <span className="text-[10px] text-muted-foreground">
                                {runs.length} run{runs.length !== 1 ? "s" : ""}
                              </span>
                            )}
                          </div>
                          {template.schedule && (
                            <p className="mt-1 text-[10px] text-muted-foreground">
                              {formatScheduleSummary(
                                template.schedule.enabled,
                                template.schedule.rrule,
                                template.schedule.timezone
                              )}
                              {nextRun && <span className="ml-2">Next: {nextRun}</span>}
                            </p>
                          )}
                        </div>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => void deleteTemplate(template.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>

                      {template.starterPrompts.length > 0 && (
                        <p className="mt-3 line-clamp-2 rounded-md bg-sidebar/50 px-3 py-2 text-xs text-muted-foreground">
                          {template.starterPrompts[0]}
                        </p>
                      )}

                      {latestRun && (
                        <div className="mt-3 flex items-center gap-2 text-[10px] text-muted-foreground">
                          <Clock3 className="size-3" />
                          Last run: {formatRunTimestamp(latestRun.updatedAtMs)}
                          <button
                            onClick={() => void selectThread(latestRun.threadId)}
                            className="text-primary hover:underline"
                          >
                            View
                          </button>
                        </div>
                      )}

                      <div className="mt-3 flex gap-2">
                        <Button
                          size="sm"
                          className="h-8"
                          onClick={() => void runTemplate(template)}
                        >
                          <Play className="mr-1.5 size-3.5" />
                          Run
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-8"
                          onClick={() => beginEditingTemplate(template)}
                        >
                          Edit
                        </Button>
                      </div>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Sidebar: Import/Export */}
      <aside className="flex w-72 flex-col border-l border-border/50 bg-sidebar/50">
        <div className="border-b border-border/30 px-4 py-3">
          <h2 className="text-xs font-medium text-muted-foreground">Import / Export</h2>
        </div>
        <div className="flex-1 space-y-4 overflow-auto p-4">
          <div className="flex gap-2">
            <Button size="sm" className="h-8 flex-1" onClick={() => void exportBundle()}>
              <FileDown className="mr-1.5 size-3.5" />
              Export
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 flex-1"
              onClick={() => void importBundle()}
            >
              <FileUp className="mr-1.5 size-3.5" />
              Import
            </Button>
          </div>
          <select
            value={bundleFormat}
            onChange={(e) => setBundleFormat(e.target.value as "json" | "yaml")}
            className="h-8 w-full rounded-md border border-border/60 bg-background px-2 text-sm"
          >
            <option value="json">JSON</option>
            <option value="yaml">YAML</option>
          </select>
          <textarea
            value={bundleJson}
            onChange={(e) => setBundleJson(e.target.value)}
            className="min-h-[200px] w-full rounded-md border border-border/60 bg-background p-2 font-mono text-[10px]"
            placeholder="Bundle content..."
          />
          <Button size="sm" variant="outline" className="w-full" onClick={() => void copyBundle()}>
            <Copy className="mr-1.5 size-3.5" />
            Copy
          </Button>
        </div>
      </aside>
    </div>
  )
}
