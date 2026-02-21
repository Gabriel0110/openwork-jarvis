import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Bot,
  ChevronDown,
  Download,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  Square,
  Trash2
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAppStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import type {
  TimelineEvent,
  ZeroClawCapabilityMode,
  ZeroClawCapabilityPolicy,
  ZeroClawDeploymentState,
  ZeroClawDoctorReport,
  ZeroClawInstallActivity,
  ZeroClawInstallStatus,
  ZeroClawRuntimeEvent,
  ZeroClawRuntimeHealth
} from "@/types"

interface ZeroClawInvocationDiagnostics {
  id: string
  threadId: string
  occurredAt: Date
  summary: string
  hasError: boolean
  errorMessage: string
  model: string
  streamed: boolean
  transport: string
  tokenChunks: number
  syntheticFallbackUsed: boolean
  durationMs: number
  attemptCount: number
  pairingRecovered: boolean
}

interface ZeroClawDeploymentFormState {
  name: string
  description: string
  workspacePath: string
  modelProvider: "anthropic" | "openai" | "google" | "ollama"
  modelName: string
  autoStart: boolean
  policyMode: ZeroClawCapabilityMode
  includeGlobalSkills: boolean
  assignedSkillIdsCsv: string
  assignedToolNamesCsv: string
  assignedConnectorKeysCsv: string
  deniedToolNamesCsv: string
  deniedConnectorKeysCsv: string
}

function defaultZeroClawDeploymentForm(): ZeroClawDeploymentFormState {
  return {
    name: "",
    description: "",
    workspacePath: "",
    modelProvider: "openai",
    modelName: "gpt-4o",
    autoStart: true,
    policyMode: "global_only",
    includeGlobalSkills: true,
    assignedSkillIdsCsv: "",
    assignedToolNamesCsv: "",
    assignedConnectorKeysCsv: "",
    deniedToolNamesCsv: "",
    deniedConnectorKeysCsv: ""
  }
}

function parseCsvList(value: string): string[] {
  return Array.from(
    new Set(
      value
        .split(",")
        .map((item) => item.trim())
        .filter((item) => item.length > 0)
    )
  )
}

function policyToForm(policy: ZeroClawCapabilityPolicy): ZeroClawDeploymentFormState {
  return {
    ...defaultZeroClawDeploymentForm(),
    policyMode: policy.mode,
    includeGlobalSkills: policy.includeGlobalSkills,
    assignedSkillIdsCsv: policy.assignedSkillIds.join(", "),
    assignedToolNamesCsv: policy.assignedToolNames.join(", "),
    assignedConnectorKeysCsv: policy.assignedConnectorKeys.join(", "),
    deniedToolNamesCsv: policy.deniedToolNames.join(", "),
    deniedConnectorKeysCsv: policy.deniedConnectorKeys.join(", ")
  }
}

function formToPolicy(form: ZeroClawDeploymentFormState): ZeroClawCapabilityPolicy {
  return {
    mode: form.policyMode,
    includeGlobalSkills: form.includeGlobalSkills,
    assignedSkillIds: parseCsvList(form.assignedSkillIdsCsv),
    assignedToolNames: parseCsvList(form.assignedToolNamesCsv),
    assignedConnectorKeys: parseCsvList(form.assignedConnectorKeysCsv),
    deniedToolNames: parseCsvList(form.deniedToolNamesCsv),
    deniedConnectorKeys: parseCsvList(form.deniedConnectorKeysCsv)
  }
}

function formatDate(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(parsed.getTime())) return "Unknown"
  return parsed.toLocaleString()
}

function toStringValue(value: unknown, fallback: string = ""): string {
  return typeof value === "string" ? value : fallback
}

function toBooleanValue(value: unknown): boolean {
  return value === true
}

function toNumberValue(value: unknown, fallback: number = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback
}

function parseZeroClawInvocationDiagnostics(
  timelineEvents: TimelineEvent[],
  deploymentId: string
): ZeroClawInvocationDiagnostics[] {
  return timelineEvents
    .filter((event) => {
      if (event.eventType !== "tool_result" && event.eventType !== "error") return false
      const payload = event.payload as Record<string, unknown>
      const speakerType = toStringValue(payload.speakerType)
      const payloadDeploymentId = toStringValue(payload.deploymentId)
      return (
        payloadDeploymentId === deploymentId &&
        (event.toolName === "zeroclaw:webhook" || speakerType === "zeroclaw")
      )
    })
    .map((event) => {
      const payload = event.payload as Record<string, unknown>
      const hasError = event.eventType === "error" || toBooleanValue(payload.hasError)
      const errorMessage =
        toStringValue(payload.errorMessage) || (hasError ? toStringValue(event.summary) : "")
      const occurredAt =
        event.occurredAt instanceof Date ? event.occurredAt : new Date(String(event.occurredAt))
      return {
        id: event.id,
        threadId: event.threadId,
        occurredAt,
        summary: event.summary || "",
        hasError,
        errorMessage,
        model: toStringValue(payload.model, "unknown"),
        streamed: toBooleanValue(payload.streamed),
        transport: toStringValue(payload.transport, "unknown"),
        tokenChunks: toNumberValue(payload.tokenChunks, 0),
        syntheticFallbackUsed: toBooleanValue(payload.syntheticFallbackUsed),
        durationMs: toNumberValue(payload.durationMs, 0),
        attemptCount: toNumberValue(payload.attemptCount, 1),
        pairingRecovered: toBooleanValue(payload.pairingRecovered)
      }
    })
    .sort((left, right) => right.occurredAt.getTime() - left.occurredAt.getTime())
}

function sanitizeFilename(value: string): string {
  return value.replace(/[^a-z0-9-_.]+/gi, "_").replace(/_+/g, "_")
}

function redactSecrets(value: unknown, keyHint?: string): unknown {
  const sensitiveKeyPattern = /(token|secret|password|api[-_]?key|authorization|auth)/i
  const isSensitiveKey = keyHint ? sensitiveKeyPattern.test(keyHint) : false

  if (isSensitiveKey) {
    if (typeof value === "string" && value.length > 0) return "[REDACTED]"
    if (Array.isArray(value)) return value.map(() => "[REDACTED]")
    if (typeof value === "object" && value !== null) return "[REDACTED]"
  }

  if (Array.isArray(value)) return value.map((item) => redactSecrets(item))
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      result[key] = redactSecrets(nested, key)
    }
    return result
  }
  if (typeof value === "string") {
    if (value.startsWith("sk-") || value.startsWith("xox")) return "[REDACTED]"
    return value
  }
  return value
}

// Collapsible section component
function CollapsibleSection({
  title,
  defaultOpen = false,
  badge,
  children
}: {
  title: string
  defaultOpen?: boolean
  badge?: React.ReactNode
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="rounded-md border border-border">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-background-interactive"
      >
        <div className="flex items-center gap-2">
          <span className="font-medium">{title}</span>
          {badge}
        </div>
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="border-t border-border p-4">{children}</div>}
    </div>
  )
}

export function ZeroClawView(): React.JSX.Element {
  const { selectThread, zeroClawDeploymentFocusId, setZeroClawDeploymentFocusId } = useAppStore()
  const [zeroClawStatus, setZeroClawStatus] = useState<ZeroClawInstallStatus | null>(null)
  const [zeroClawInstallActivity, setZeroClawInstallActivity] =
    useState<ZeroClawInstallActivity | null>(null)
  const [zeroClawDeployments, setZeroClawDeployments] = useState<ZeroClawDeploymentState[]>([])
  const [selectedZeroClawDeploymentId, setSelectedZeroClawDeploymentId] = useState<string | null>(
    null
  )
  const [zeroClawHealth, setZeroClawHealth] = useState<ZeroClawRuntimeHealth | null>(null)
  const [zeroClawEvents, setZeroClawEvents] = useState<ZeroClawRuntimeEvent[]>([])
  const [zeroClawEventsCursor, setZeroClawEventsCursor] = useState<string | undefined>(undefined)
  const [zeroClawInvocations, setZeroClawInvocations] = useState<ZeroClawInvocationDiagnostics[]>(
    []
  )
  const [lastDiagnosticsRefreshAt, setLastDiagnosticsRefreshAt] = useState<Date | null>(null)
  const [autoRefreshDiagnostics, setAutoRefreshDiagnostics] = useState(true)
  const [zeroClawStatusMessage, setZeroClawStatusMessage] = useState<string | null>(null)
  const [isZeroClawBusy, setIsZeroClawBusy] = useState(false)
  const [isZeroClawCreatingDeployment, setIsZeroClawCreatingDeployment] = useState(false)
  const [isLoading, setIsLoading] = useState(false)
  const [selectedUpgradeVersion, setSelectedUpgradeVersion] = useState<string>("")
  const [zeroClawDoctorReport, setZeroClawDoctorReport] = useState<ZeroClawDoctorReport | null>(
    null
  )
  const [transportFilter, setTransportFilter] = useState<
    "all" | "sse" | "ndjson" | "json" | "unknown"
  >("all")
  const [fallbackOnly, setFallbackOnly] = useState(false)
  const [errorsOnly, setErrorsOnly] = useState(false)
  const [zeroClawForm, setZeroClawForm] = useState<ZeroClawDeploymentFormState>(
    defaultZeroClawDeploymentForm
  )
  const [showAdvancedPolicy, setShowAdvancedPolicy] = useState(false)
  const installActivityLogRef = useRef<HTMLDivElement | null>(null)

  const selectedZeroClawDeployment = useMemo(
    () => zeroClawDeployments.find((entry) => entry.id === selectedZeroClawDeploymentId) || null,
    [selectedZeroClawDeploymentId, zeroClawDeployments]
  )

  const zeroClawInvocationStats = useMemo(() => {
    if (zeroClawInvocations.length === 0) {
      return {
        total: 0,
        streamed: 0,
        syntheticFallback: 0,
        pairedRecoveries: 0,
        averageDurationMs: 0
      }
    }
    const totals = zeroClawInvocations.reduce(
      (acc, entry) => {
        acc.streamed += entry.streamed ? 1 : 0
        acc.syntheticFallback += entry.syntheticFallbackUsed ? 1 : 0
        acc.pairedRecoveries += entry.pairingRecovered ? 1 : 0
        acc.durationMs += entry.durationMs
        return acc
      },
      { streamed: 0, syntheticFallback: 0, pairedRecoveries: 0, durationMs: 0 }
    )
    return {
      total: zeroClawInvocations.length,
      streamed: totals.streamed,
      syntheticFallback: totals.syntheticFallback,
      pairedRecoveries: totals.pairedRecoveries,
      averageDurationMs: Math.round(totals.durationMs / zeroClawInvocations.length)
    }
  }, [zeroClawInvocations])

  const filteredZeroClawInvocations = useMemo(() => {
    return zeroClawInvocations.filter((entry) => {
      const normalizedTransport = entry.transport.trim().toLowerCase()
      const transportBucket =
        normalizedTransport === "sse" ||
        normalizedTransport === "ndjson" ||
        normalizedTransport === "json"
          ? normalizedTransport
          : "unknown"
      if (transportFilter !== "all" && transportBucket !== transportFilter) return false
      if (fallbackOnly && !entry.syntheticFallbackUsed) return false
      if (errorsOnly && !entry.hasError) return false
      return true
    })
  }, [errorsOnly, fallbackOnly, transportFilter, zeroClawInvocations])

  const recentZeroClawInvocations = useMemo(
    () => filteredZeroClawInvocations.slice(0, 40),
    [filteredZeroClawInvocations]
  )

  const refreshInstallActivity = useCallback(
    async (options?: { silent?: boolean }): Promise<void> => {
      try {
        const activity = await window.api.zeroclaw.install.getActivity()
        setZeroClawInstallActivity(activity)
      } catch (error) {
        if (!options?.silent) {
          setZeroClawStatusMessage(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
        }
      }
    },
    []
  )

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    try {
      const [status, deployments, activity] = await Promise.all([
        window.api.zeroclaw.install.getStatus(),
        window.api.zeroclaw.deployment.list(),
        window.api.zeroclaw.install.getActivity()
      ])
      setZeroClawStatus(status)
      setZeroClawDeployments(deployments)
      setZeroClawInstallActivity(activity)
      setSelectedUpgradeVersion((current) => {
        const available = status.availableVersions || []
        if (available.length === 0) return ""
        if (current && available.includes(current)) return current
        const preferred = available.find((entry) => entry !== status.activeVersion)
        return preferred || available[0]
      })
    } catch (error) {
      setZeroClawStatusMessage(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refreshSelectedDeploymentRuntimeData = useCallback(
    async (options?: { silent?: boolean }): Promise<void> => {
      if (
        !selectedZeroClawDeploymentId ||
        !selectedZeroClawDeployment ||
        isZeroClawCreatingDeployment
      )
        return
      try {
        const [health, logs, timelineEvents] = await Promise.all([
          window.api.zeroclaw.runtime.getHealth(selectedZeroClawDeploymentId),
          window.api.zeroclaw.logs.get(selectedZeroClawDeploymentId, undefined, 120),
          window.api.timeline.listWorkspace(selectedZeroClawDeployment.workspaceId, 500)
        ])
        setZeroClawHealth(health)
        setZeroClawEvents(logs.events)
        setZeroClawEventsCursor(logs.nextCursor)
        setZeroClawInvocations(
          parseZeroClawInvocationDiagnostics(timelineEvents, selectedZeroClawDeploymentId)
        )
        setLastDiagnosticsRefreshAt(new Date())
      } catch (error) {
        if (!options?.silent) {
          setZeroClawStatusMessage(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
        }
      }
    },
    [isZeroClawCreatingDeployment, selectedZeroClawDeployment, selectedZeroClawDeploymentId]
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (zeroClawDeployments.length === 0) {
      setSelectedZeroClawDeploymentId(null)
      setZeroClawHealth(null)
      setZeroClawEvents([])
      setZeroClawEventsCursor(undefined)
      setZeroClawInvocations([])
      setLastDiagnosticsRefreshAt(null)
      return
    }
    const hasSelected = selectedZeroClawDeploymentId
      ? zeroClawDeployments.some((entry) => entry.id === selectedZeroClawDeploymentId)
      : false
    if (!hasSelected && !isZeroClawCreatingDeployment) {
      setSelectedZeroClawDeploymentId(zeroClawDeployments[0].id)
    }
  }, [isZeroClawCreatingDeployment, selectedZeroClawDeploymentId, zeroClawDeployments])

  useEffect(() => {
    if (!zeroClawDeploymentFocusId || zeroClawDeployments.length === 0) return
    const focused = zeroClawDeployments.find((d) => d.id === zeroClawDeploymentFocusId)
    if (focused) {
      setIsZeroClawCreatingDeployment(false)
      setSelectedZeroClawDeploymentId(focused.id)
      setZeroClawStatusMessage(`Focused "${focused.name}".`)
    } else {
      setZeroClawStatusMessage("Focused deployment not found.")
    }
    setZeroClawDeploymentFocusId(null)
  }, [zeroClawDeploymentFocusId, zeroClawDeployments, setZeroClawDeploymentFocusId])

  useEffect(() => {
    if (!selectedZeroClawDeployment || isZeroClawCreatingDeployment) return
    setZeroClawForm({
      ...policyToForm(selectedZeroClawDeployment.policy),
      name: selectedZeroClawDeployment.name,
      description: selectedZeroClawDeployment.description || "",
      workspacePath: selectedZeroClawDeployment.workspacePath,
      modelProvider: selectedZeroClawDeployment.modelProvider,
      modelName: selectedZeroClawDeployment.modelName,
      autoStart: selectedZeroClawDeployment.desiredState === "running"
    })
  }, [isZeroClawCreatingDeployment, selectedZeroClawDeployment])

  useEffect(() => {
    setZeroClawDoctorReport(null)
  }, [selectedZeroClawDeploymentId])

  useEffect(() => {
    if (
      !selectedZeroClawDeploymentId ||
      !selectedZeroClawDeployment ||
      isZeroClawCreatingDeployment
    )
      return
    void refreshSelectedDeploymentRuntimeData()
  }, [
    isZeroClawCreatingDeployment,
    refreshSelectedDeploymentRuntimeData,
    selectedZeroClawDeployment,
    selectedZeroClawDeploymentId
  ])

  useEffect(() => {
    if (zeroClawInstallActivity?.state !== "running") return
    const timer = setInterval(() => void refreshInstallActivity({ silent: true }), 500)
    return () => clearInterval(timer)
  }, [refreshInstallActivity, zeroClawInstallActivity?.state])

  useEffect(() => {
    if (!installActivityLogRef.current) return
    installActivityLogRef.current.scrollTop = installActivityLogRef.current.scrollHeight
  }, [zeroClawInstallActivity?.lines.length])

  useEffect(() => {
    if (
      !autoRefreshDiagnostics ||
      !selectedZeroClawDeploymentId ||
      !selectedZeroClawDeployment ||
      isZeroClawCreatingDeployment
    )
      return
    const timer = setInterval(
      () => void refreshSelectedDeploymentRuntimeData({ silent: true }),
      2500
    )
    return () => clearInterval(timer)
  }, [
    autoRefreshDiagnostics,
    isZeroClawCreatingDeployment,
    refreshSelectedDeploymentRuntimeData,
    selectedZeroClawDeployment,
    selectedZeroClawDeploymentId
  ])

  function startCreateZeroClawDeployment(): void {
    setIsZeroClawCreatingDeployment(true)
    setSelectedZeroClawDeploymentId(null)
    setZeroClawInvocations([])
    setZeroClawStatusMessage("Configure a new deployment.")
    setZeroClawForm(defaultZeroClawDeploymentForm())
    setShowAdvancedPolicy(true)
  }

  function selectZeroClawDeployment(deploymentId: string): void {
    setIsZeroClawCreatingDeployment(false)
    setSelectedZeroClawDeploymentId(deploymentId)
    setZeroClawStatusMessage(null)
  }

  async function installZeroClawRuntime(): Promise<void> {
    setIsZeroClawBusy(true)
    setZeroClawStatusMessage(null)
    try {
      await refreshInstallActivity({ silent: true })
      const status = await window.api.zeroclaw.install.installVersion()
      setZeroClawStatus(status)
      await refreshInstallActivity({ silent: true })
      await load()
      setZeroClawStatusMessage(
        status.activeVersion ? `Installed ${status.activeVersion}.` : "Install completed."
      )
    } catch (error) {
      setZeroClawStatusMessage(
        `Install failed: ${error instanceof Error ? error.message : "Unknown"}`
      )
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  async function verifyZeroClawRuntime(): Promise<void> {
    setIsZeroClawBusy(true)
    try {
      const result = await window.api.zeroclaw.install.verify()
      setZeroClawStatusMessage(result.message)
    } catch (error) {
      setZeroClawStatusMessage(
        `Verify failed: ${error instanceof Error ? error.message : "Unknown"}`
      )
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  async function upgradeZeroClawRuntime(): Promise<void> {
    if (!selectedUpgradeVersion) {
      setZeroClawStatusMessage("Select a version to upgrade.")
      return
    }
    setIsZeroClawBusy(true)
    setZeroClawStatusMessage(null)
    try {
      await refreshInstallActivity({ silent: true })
      const status = await window.api.zeroclaw.install.upgrade(selectedUpgradeVersion)
      setZeroClawStatus(status)
      await refreshInstallActivity({ silent: true })
      await load()
      setZeroClawStatusMessage(`Upgraded to ${selectedUpgradeVersion}.`)
    } catch (error) {
      setZeroClawStatusMessage(
        `Upgrade failed: ${error instanceof Error ? error.message : "Unknown"}`
      )
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  async function copyInstallActivityLog(): Promise<void> {
    if (!zeroClawInstallActivity || zeroClawInstallActivity.lines.length === 0) {
      setZeroClawStatusMessage("No logs available.")
      return
    }
    const payload = zeroClawInstallActivity.lines
      .map(
        (line) => `[${formatDate(line.occurredAt)}] ${line.stream.toUpperCase()} ${line.message}`
      )
      .join("\n")
    try {
      await navigator.clipboard.writeText(payload)
      setZeroClawStatusMessage("Copied logs.")
    } catch {
      setZeroClawStatusMessage("Copy failed.")
    }
  }

  async function saveZeroClawDeployment(): Promise<void> {
    setIsZeroClawBusy(true)
    setZeroClawStatusMessage(null)
    try {
      const policy = formToPolicy(zeroClawForm)
      if (isZeroClawCreatingDeployment) {
        const created = await window.api.zeroclaw.deployment.create({
          name: zeroClawForm.name.trim(),
          description: zeroClawForm.description.trim(),
          workspacePath: zeroClawForm.workspacePath.trim(),
          modelProvider: zeroClawForm.modelProvider,
          modelName: zeroClawForm.modelName.trim(),
          policy,
          autoStart: zeroClawForm.autoStart
        })
        await load()
        setIsZeroClawCreatingDeployment(false)
        setSelectedZeroClawDeploymentId(created.id)
        setZeroClawStatusMessage(`Created "${created.name}".`)
        return
      }

      if (!selectedZeroClawDeployment) {
        setZeroClawStatusMessage("Select a deployment first.")
        return
      }

      const updated = await window.api.zeroclaw.deployment.update(selectedZeroClawDeployment.id, {
        name: zeroClawForm.name.trim(),
        description: zeroClawForm.description.trim(),
        workspacePath: zeroClawForm.workspacePath.trim(),
        modelProvider: zeroClawForm.modelProvider,
        modelName: zeroClawForm.modelName.trim(),
        desiredState: zeroClawForm.autoStart ? "running" : "stopped",
        policy
      })
      await load()
      setSelectedZeroClawDeploymentId(updated.id)
      setZeroClawStatusMessage(`Saved "${updated.name}".`)
    } catch (error) {
      setZeroClawStatusMessage(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  async function deleteZeroClawDeployment(): Promise<void> {
    if (!selectedZeroClawDeployment) return
    if (!window.confirm(`Delete "${selectedZeroClawDeployment.name}"?`)) return
    setIsZeroClawBusy(true)
    try {
      await window.api.zeroclaw.deployment.delete(selectedZeroClawDeployment.id)
      await load()
      setSelectedZeroClawDeploymentId(null)
      setZeroClawStatusMessage(`Deleted "${selectedZeroClawDeployment.name}".`)
    } catch (error) {
      setZeroClawStatusMessage(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  async function runtimeAction(action: "start" | "stop" | "restart"): Promise<void> {
    if (!selectedZeroClawDeployment) return
    setIsZeroClawBusy(true)
    setZeroClawStatusMessage(null)
    try {
      if (action === "start") {
        await window.api.zeroclaw.runtime.start(selectedZeroClawDeployment.id)
      } else if (action === "stop") {
        await window.api.zeroclaw.runtime.stop(selectedZeroClawDeployment.id)
      } else {
        await window.api.zeroclaw.runtime.restart(selectedZeroClawDeployment.id)
      }
      await load()
      await refreshSelectedDeploymentRuntimeData()
      setZeroClawStatusMessage(`${action[0].toUpperCase()}${action.slice(1)} sent.`)
    } catch (error) {
      setZeroClawStatusMessage(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  async function applyRuntimeVersionToDeployment(): Promise<void> {
    if (!selectedZeroClawDeployment || !selectedUpgradeVersion) return
    if (selectedUpgradeVersion === selectedZeroClawDeployment.runtimeVersion) {
      setZeroClawStatusMessage("Already using this version.")
      return
    }
    setIsZeroClawBusy(true)
    setZeroClawStatusMessage(null)
    try {
      const updated = await window.api.zeroclaw.deployment.update(selectedZeroClawDeployment.id, {
        runtimeVersion: selectedUpgradeVersion
      })
      if (selectedZeroClawDeployment.status === "running") {
        await window.api.zeroclaw.runtime.restart(selectedZeroClawDeployment.id)
      }
      await load()
      setSelectedZeroClawDeploymentId(updated.id)
      await refreshSelectedDeploymentRuntimeData()
      setZeroClawStatusMessage(`Applied ${selectedUpgradeVersion}.`)
    } catch (error) {
      setZeroClawStatusMessage(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  async function runZeroClawDoctor(): Promise<void> {
    setIsZeroClawBusy(true)
    try {
      const report = await window.api.zeroclaw.doctor.run(selectedZeroClawDeployment?.id)
      setZeroClawDoctorReport(report)
      const failures = report.checks.filter((check) => !check.ok)
      setZeroClawStatusMessage(
        failures.length === 0 ? "Doctor passed." : `Doctor found ${failures.length} issue(s).`
      )
    } catch (error) {
      setZeroClawStatusMessage(
        `Doctor failed: ${error instanceof Error ? error.message : "Unknown"}`
      )
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  async function openInvocationThread(threadId: string): Promise<void> {
    try {
      await selectThread(threadId)
    } catch (error) {
      setZeroClawStatusMessage(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    }
  }

  async function loadOlderRuntimeEvents(): Promise<void> {
    if (!selectedZeroClawDeploymentId || !zeroClawEventsCursor) return
    setIsZeroClawBusy(true)
    try {
      const result = await window.api.zeroclaw.logs.get(
        selectedZeroClawDeploymentId,
        zeroClawEventsCursor,
        120
      )
      setZeroClawEvents((current) => {
        const mergedById = new Map<string, ZeroClawRuntimeEvent>()
        for (const entry of current) mergedById.set(entry.id, entry)
        for (const entry of result.events) mergedById.set(entry.id, entry)
        return Array.from(mergedById.values()).sort(
          (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime()
        )
      })
      setZeroClawEventsCursor(result.nextCursor)
    } catch (error) {
      setZeroClawStatusMessage(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  function exportInvocationDiagnosticsJson(): void {
    if (!selectedZeroClawDeployment || zeroClawInvocations.length === 0) {
      setZeroClawStatusMessage("No diagnostics to export.")
      return
    }
    try {
      const exportedAt = new Date().toISOString()
      const payload = {
        deployment: {
          id: selectedZeroClawDeployment.id,
          name: selectedZeroClawDeployment.name,
          workspaceId: selectedZeroClawDeployment.workspaceId,
          modelProvider: selectedZeroClawDeployment.modelProvider,
          modelName: selectedZeroClawDeployment.modelName
        },
        stats: zeroClawInvocationStats,
        exportedAt,
        invocations: zeroClawInvocations.map((entry) => ({
          id: entry.id,
          threadId: entry.threadId,
          occurredAt:
            entry.occurredAt instanceof Date
              ? entry.occurredAt.toISOString()
              : String(entry.occurredAt),
          summary: entry.summary,
          model: entry.model,
          streamed: entry.streamed,
          transport: entry.transport,
          tokenChunks: entry.tokenChunks,
          syntheticFallbackUsed: entry.syntheticFallbackUsed,
          durationMs: entry.durationMs,
          attemptCount: entry.attemptCount,
          pairingRecovered: entry.pairingRecovered
        }))
      }
      const fileName = `zeroclaw-diagnostics-${sanitizeFilename(selectedZeroClawDeployment.name || selectedZeroClawDeployment.id)}-${exportedAt.replace(/[:.]/g, "-")}.json`
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setZeroClawStatusMessage(`Exported ${payload.invocations.length} entries.`)
    } catch (error) {
      setZeroClawStatusMessage(
        `Export failed: ${error instanceof Error ? error.message : "Unknown"}`
      )
    }
  }

  async function exportDiagnosticsBundleJson(): Promise<void> {
    if (!selectedZeroClawDeployment) {
      setZeroClawStatusMessage("Select a deployment first.")
      return
    }
    try {
      const exportedAt = new Date().toISOString()
      const report =
        zeroClawDoctorReport ||
        (await window.api.zeroclaw.doctor.run(selectedZeroClawDeployment.id))
      if (!zeroClawDoctorReport) setZeroClawDoctorReport(report)
      const payload = {
        exportedAt,
        runtimeInstall: {
          state: zeroClawStatus?.state || "unknown",
          activeVersion: zeroClawStatus?.activeVersion || null,
          availableVersions: zeroClawStatus?.availableVersions || [],
          runtimeRoot: zeroClawStatus?.runtimeRoot || null
        },
        deployment: redactSecrets({
          id: selectedZeroClawDeployment.id,
          name: selectedZeroClawDeployment.name,
          workspaceId: selectedZeroClawDeployment.workspaceId,
          runtimeVersion: selectedZeroClawDeployment.runtimeVersion,
          modelProvider: selectedZeroClawDeployment.modelProvider,
          modelName: selectedZeroClawDeployment.modelName,
          status: selectedZeroClawDeployment.status,
          desiredState: selectedZeroClawDeployment.desiredState,
          gatewayHost: selectedZeroClawDeployment.gatewayHost,
          gatewayPort: selectedZeroClawDeployment.gatewayPort,
          apiBaseUrl: selectedZeroClawDeployment.apiBaseUrl,
          policy: selectedZeroClawDeployment.policy,
          effectiveCapabilities: selectedZeroClawDeployment.effectiveCapabilities
        }),
        health: redactSecrets(zeroClawHealth),
        doctor: redactSecrets(report),
        diagnostics: {
          lastRefreshAt: lastDiagnosticsRefreshAt ? lastDiagnosticsRefreshAt.toISOString() : null,
          autoRefresh: autoRefreshDiagnostics,
          filters: { transport: transportFilter, fallbackOnly, errorsOnly },
          invocationStats: zeroClawInvocationStats
        },
        invocations: redactSecrets(
          zeroClawInvocations.map((entry) => ({
            id: entry.id,
            threadId: entry.threadId,
            occurredAt: entry.occurredAt.toISOString(),
            summary: entry.summary,
            hasError: entry.hasError,
            errorMessage: entry.errorMessage,
            model: entry.model,
            streamed: entry.streamed,
            transport: entry.transport,
            tokenChunks: entry.tokenChunks,
            syntheticFallbackUsed: entry.syntheticFallbackUsed,
            durationMs: entry.durationMs,
            attemptCount: entry.attemptCount,
            pairingRecovered: entry.pairingRecovered
          }))
        ),
        runtimeEvents: redactSecrets(
          zeroClawEvents.map((event) => ({
            id: event.id,
            deploymentId: event.deploymentId,
            eventType: event.eventType,
            severity: event.severity,
            message: event.message,
            payload: event.payload,
            correlationId: event.correlationId,
            occurredAt: event.occurredAt.toISOString()
          }))
        )
      }
      const fileName = `zeroclaw-bundle-${sanitizeFilename(selectedZeroClawDeployment.name || selectedZeroClawDeployment.id)}-${exportedAt.replace(/[:.]/g, "-")}.json`
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setZeroClawStatusMessage("Exported bundle.")
    } catch (error) {
      setZeroClawStatusMessage(
        `Export failed: ${error instanceof Error ? error.message : "Unknown"}`
      )
    }
  }

  return (
    <section className="page-container">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold">ZeroClaw</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Managed runtime, deployments, and diagnostics
          </p>
        </div>
        <Button size="sm" variant="outline" onClick={() => void load()} disabled={isLoading}>
          <RefreshCw className={cn("mr-2 size-4", isLoading && "animate-spin")} />
          Refresh
        </Button>
      </div>

      {zeroClawStatusMessage && (
        <div className="mt-4 rounded-md border border-border bg-sidebar px-4 py-2 text-sm text-muted-foreground">
          {zeroClawStatusMessage}
        </div>
      )}

      {/* Stats row */}
      <div className="mt-6 flex items-center gap-6 text-sm">
        <div className="flex items-center gap-2">
          <span className="text-muted-foreground">Runtime:</span>
          <Badge variant={zeroClawStatus?.state === "installed" ? "info" : "outline"}>
            {zeroClawStatus?.state || "unknown"}
          </Badge>
        </div>
        {zeroClawStatus?.activeVersion && (
          <span className="text-muted-foreground">
            Version:{" "}
            <span className="font-medium text-foreground">{zeroClawStatus.activeVersion}</span>
          </span>
        )}
        <span className="text-muted-foreground">
          Deployments:{" "}
          <span className="font-medium text-foreground">{zeroClawDeployments.length}</span>
        </span>
      </div>

      {/* Runtime controls */}
      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={isZeroClawBusy}
          onClick={() => void installZeroClawRuntime()}
        >
          Install Runtime
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={isZeroClawBusy}
          onClick={() => void verifyZeroClawRuntime()}
        >
          Verify
        </Button>
        <select
          value={selectedUpgradeVersion}
          onChange={(e) => setSelectedUpgradeVersion(e.target.value)}
          className="h-9 rounded-md border border-input bg-background px-3 text-sm"
          disabled={isZeroClawBusy || (zeroClawStatus?.availableVersions.length || 0) === 0}
        >
          {(zeroClawStatus?.availableVersions || []).map((version) => (
            <option key={version} value={version}>
              {version}
              {zeroClawStatus?.activeVersion === version ? " (active)" : ""}
            </option>
          ))}
          {(zeroClawStatus?.availableVersions || []).length === 0 && (
            <option value="">No versions</option>
          )}
        </select>
        <Button
          size="sm"
          variant="outline"
          disabled={isZeroClawBusy || !selectedUpgradeVersion}
          onClick={() => void upgradeZeroClawRuntime()}
        >
          Upgrade
        </Button>
        <Button size="sm" variant="outline" onClick={startCreateZeroClawDeployment}>
          <Plus className="mr-1 size-4" />
          New Deployment
        </Button>
      </div>

      <div className="mt-6 space-y-4">
        {/* Install Activity - collapsible */}
        <CollapsibleSection
          title="Install Activity"
          badge={
            <Badge
              variant={
                zeroClawInstallActivity?.state === "error"
                  ? "critical"
                  : zeroClawInstallActivity?.state === "running"
                    ? "warning"
                    : zeroClawInstallActivity?.state === "success"
                      ? "info"
                      : "outline"
              }
            >
              {zeroClawInstallActivity?.state || "idle"}
            </Badge>
          }
        >
          <div className="flex items-center gap-4 text-sm text-muted-foreground">
            <span>Phase: {zeroClawInstallActivity?.phase || "idle"}</span>
            <span>Lines: {zeroClawInstallActivity?.lines.length || 0}</span>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void refreshInstallActivity()}
              disabled={isZeroClawBusy && zeroClawInstallActivity?.state === "running"}
            >
              Refresh
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => void copyInstallActivityLog()}
              disabled={(zeroClawInstallActivity?.lines.length || 0) === 0}
            >
              Copy Logs
            </Button>
          </div>
          <div
            ref={installActivityLogRef}
            className="mt-3 max-h-40 overflow-auto rounded-md border border-border bg-sidebar p-3 font-mono text-xs"
          >
            {!zeroClawInstallActivity || zeroClawInstallActivity.lines.length === 0 ? (
              <div className="text-muted-foreground">No activity yet.</div>
            ) : (
              zeroClawInstallActivity.lines.map((line) => (
                <div
                  key={line.id}
                  className={
                    line.stream === "stderr" ? "text-status-critical" : "text-muted-foreground"
                  }
                >
                  [{formatDate(line.occurredAt)}] {line.stream.toUpperCase()} {line.message}
                </div>
              ))
            )}
          </div>
          {zeroClawInstallActivity?.lastError && (
            <div className="mt-2 text-sm text-status-critical">
              {zeroClawInstallActivity.lastError}
            </div>
          )}
        </CollapsibleSection>

        {/* Deployments */}
        <div className="rounded-md border border-border">
          <div className="flex items-center justify-between border-b border-border px-4 py-3">
            <div className="flex items-center gap-2">
              <Bot className="size-4 text-muted-foreground" />
              <span className="font-medium">Deployments</span>
            </div>
          </div>

          {zeroClawDeployments.length === 0 ? (
            <div className="p-8 text-center text-sm text-muted-foreground">
              No deployments configured.
            </div>
          ) : (
            <div className="grid gap-2 p-4 sm:grid-cols-2 lg:grid-cols-3">
              {zeroClawDeployments.map((deployment) => (
                <button
                  key={deployment.id}
                  onClick={() => selectZeroClawDeployment(deployment.id)}
                  className={cn(
                    "rounded-md border p-3 text-left transition-colors",
                    selectedZeroClawDeploymentId === deployment.id && !isZeroClawCreatingDeployment
                      ? "border-primary bg-primary/5"
                      : "border-border hover:border-primary/50"
                  )}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium">{deployment.name}</span>
                    <Badge
                      variant={
                        deployment.status === "running"
                          ? "info"
                          : deployment.status === "error"
                            ? "critical"
                            : "outline"
                      }
                    >
                      {deployment.status}
                    </Badge>
                  </div>
                  <div className="mt-1 text-xs text-muted-foreground">{deployment.modelName}</div>
                  <div className="mt-1 truncate text-xs text-muted-foreground">
                    {deployment.workspacePath}
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Deployment Editor */}
        {(selectedZeroClawDeployment || isZeroClawCreatingDeployment) && (
          <div className="rounded-md border border-border">
            <div className="border-b border-border px-4 py-3">
              <span className="font-medium">
                {isZeroClawCreatingDeployment ? "New Deployment" : "Deployment Config"}
              </span>
            </div>

            <div className="space-y-4 p-4">
              {/* Basic fields */}
              <div className="grid gap-4 sm:grid-cols-2">
                <div className="form-group">
                  <label className="form-label">Name</label>
                  <Input
                    value={zeroClawForm.name}
                    onChange={(e) => setZeroClawForm((c) => ({ ...c, name: e.target.value }))}
                    placeholder="My Deployment"
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Workspace Path</label>
                  <Input
                    value={zeroClawForm.workspacePath}
                    onChange={(e) =>
                      setZeroClawForm((c) => ({ ...c, workspacePath: e.target.value }))
                    }
                    placeholder="/path/to/workspace"
                  />
                </div>
              </div>

              <div className="form-group">
                <label className="form-label">Description</label>
                <textarea
                  value={zeroClawForm.description}
                  onChange={(e) => setZeroClawForm((c) => ({ ...c, description: e.target.value }))}
                  rows={2}
                  className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                />
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div className="form-group">
                  <label className="form-label">Provider</label>
                  <select
                    value={zeroClawForm.modelProvider}
                    onChange={(e) =>
                      setZeroClawForm((c) => ({
                        ...c,
                        modelProvider: e.target
                          .value as ZeroClawDeploymentFormState["modelProvider"]
                      }))
                    }
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    <option value="openai">openai</option>
                    <option value="anthropic">anthropic</option>
                    <option value="google">google</option>
                    <option value="ollama">ollama</option>
                  </select>
                </div>
                <div className="form-group">
                  <label className="form-label">Model</label>
                  <Input
                    value={zeroClawForm.modelName}
                    onChange={(e) => setZeroClawForm((c) => ({ ...c, modelName: e.target.value }))}
                  />
                </div>
                <div className="form-group">
                  <label className="form-label">Runtime</label>
                  <label className="mt-1 flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                    <input
                      type="checkbox"
                      checked={zeroClawForm.autoStart}
                      onChange={(e) =>
                        setZeroClawForm((c) => ({ ...c, autoStart: e.target.checked }))
                      }
                      className="size-4"
                    />
                    Auto-start
                  </label>
                </div>
              </div>

              {/* Advanced policy - collapsible */}
              <button
                onClick={() => setShowAdvancedPolicy(!showAdvancedPolicy)}
                className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
              >
                <ChevronDown
                  className={cn("size-4 transition-transform", showAdvancedPolicy && "rotate-180")}
                />
                Advanced policy
              </button>

              {showAdvancedPolicy && (
                <div className="space-y-4 border-t border-border pt-4">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="form-group">
                      <label className="form-label">Policy Mode</label>
                      <select
                        value={zeroClawForm.policyMode}
                        onChange={(e) =>
                          setZeroClawForm((c) => ({
                            ...c,
                            policyMode: e.target.value as ZeroClawCapabilityMode
                          }))
                        }
                        className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                      >
                        <option value="global_only">global_only</option>
                        <option value="global_plus_assigned">global_plus_assigned</option>
                        <option value="assigned_only">assigned_only</option>
                        <option value="deny_all_except_assigned">deny_all_except_assigned</option>
                      </select>
                    </div>
                    <div className="form-group">
                      <label className="form-label">Global Skills</label>
                      <label className="mt-1 flex h-9 items-center gap-2 rounded-md border border-input bg-background px-3 text-sm">
                        <input
                          type="checkbox"
                          checked={zeroClawForm.includeGlobalSkills}
                          onChange={(e) =>
                            setZeroClawForm((c) => ({
                              ...c,
                              includeGlobalSkills: e.target.checked
                            }))
                          }
                          className="size-4"
                        />
                        Include global skills
                      </label>
                    </div>
                  </div>

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="form-group">
                      <label className="form-label">Assigned Skills (CSV)</label>
                      <Input
                        value={zeroClawForm.assignedSkillIdsCsv}
                        onChange={(e) =>
                          setZeroClawForm((c) => ({ ...c, assignedSkillIdsCsv: e.target.value }))
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Assigned Tools (CSV)</label>
                      <Input
                        value={zeroClawForm.assignedToolNamesCsv}
                        onChange={(e) =>
                          setZeroClawForm((c) => ({ ...c, assignedToolNamesCsv: e.target.value }))
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Assigned Connectors (CSV)</label>
                      <Input
                        value={zeroClawForm.assignedConnectorKeysCsv}
                        onChange={(e) =>
                          setZeroClawForm((c) => ({
                            ...c,
                            assignedConnectorKeysCsv: e.target.value
                          }))
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Denied Tools (CSV)</label>
                      <Input
                        value={zeroClawForm.deniedToolNamesCsv}
                        onChange={(e) =>
                          setZeroClawForm((c) => ({ ...c, deniedToolNamesCsv: e.target.value }))
                        }
                      />
                    </div>
                    <div className="form-group">
                      <label className="form-label">Denied Connectors (CSV)</label>
                      <Input
                        value={zeroClawForm.deniedConnectorKeysCsv}
                        onChange={(e) =>
                          setZeroClawForm((c) => ({ ...c, deniedConnectorKeysCsv: e.target.value }))
                        }
                      />
                    </div>
                  </div>
                </div>
              )}

              {/* Actions */}
              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Button disabled={isZeroClawBusy} onClick={() => void saveZeroClawDeployment()}>
                  <Save className="mr-2 size-4" />
                  {isZeroClawBusy ? "Saving..." : isZeroClawCreatingDeployment ? "Create" : "Save"}
                </Button>
                {!isZeroClawCreatingDeployment && selectedZeroClawDeployment && (
                  <>
                    <Button
                      variant="outline"
                      disabled={isZeroClawBusy}
                      onClick={() => void runtimeAction("start")}
                    >
                      <Play className="mr-1 size-4" />
                      Start
                    </Button>
                    <Button
                      variant="outline"
                      disabled={isZeroClawBusy}
                      onClick={() => void runtimeAction("stop")}
                    >
                      <Square className="mr-1 size-4" />
                      Stop
                    </Button>
                    <Button
                      variant="outline"
                      disabled={isZeroClawBusy}
                      onClick={() => void runtimeAction("restart")}
                    >
                      <RotateCcw className="mr-1 size-4" />
                      Restart
                    </Button>
                    <Button
                      variant="outline"
                      disabled={
                        isZeroClawBusy ||
                        !selectedUpgradeVersion ||
                        selectedUpgradeVersion === selectedZeroClawDeployment.runtimeVersion
                      }
                      onClick={() => void applyRuntimeVersionToDeployment()}
                    >
                      Apply Runtime
                    </Button>
                    <Button
                      variant="outline"
                      disabled={isZeroClawBusy}
                      onClick={() => void runZeroClawDoctor()}
                    >
                      Doctor
                    </Button>
                    <Button
                      variant="outline"
                      disabled={isZeroClawBusy}
                      onClick={() => void deleteZeroClawDeployment()}
                    >
                      <Trash2 className="mr-1 size-4" />
                      Delete
                    </Button>
                  </>
                )}
                {isZeroClawCreatingDeployment && (
                  <Button
                    variant="outline"
                    onClick={() => {
                      setIsZeroClawCreatingDeployment(false)
                      if (zeroClawDeployments.length > 0) {
                        setSelectedZeroClawDeploymentId(zeroClawDeployments[0].id)
                      }
                    }}
                  >
                    Cancel
                  </Button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* Deployment Status & Diagnostics - only when deployment is selected */}
        {!isZeroClawCreatingDeployment && selectedZeroClawDeployment && (
          <>
            {/* Status summary */}
            <div className="rounded-md border border-border p-4">
              <div className="text-sm font-medium">Deployment Status</div>
              <div className="mt-3 grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <span className="text-muted-foreground">Status:</span>{" "}
                  <span className="font-medium">{selectedZeroClawDeployment.status}</span>
                </div>
                <div>
                  <span className="text-muted-foreground">Desired:</span>{" "}
                  {selectedZeroClawDeployment.desiredState}
                </div>
                <div>
                  <span className="text-muted-foreground">Runtime:</span>{" "}
                  {selectedZeroClawDeployment.runtimeVersion}
                </div>
                <div>
                  <span className="text-muted-foreground">Health:</span>{" "}
                  {zeroClawHealth
                    ? `${zeroClawHealth.status}${zeroClawHealth.latencyMs ? ` (${zeroClawHealth.latencyMs}ms)` : ""}`
                    : "unknown"}
                </div>
                <div className="sm:col-span-2">
                  <span className="text-muted-foreground">Endpoint:</span>{" "}
                  {selectedZeroClawDeployment.apiBaseUrl}
                </div>
                <div className="sm:col-span-2">
                  <span className="text-muted-foreground">Effective:</span>{" "}
                  {selectedZeroClawDeployment.effectiveCapabilities.skills.length} skills,{" "}
                  {selectedZeroClawDeployment.effectiveCapabilities.tools.length} tools,{" "}
                  {selectedZeroClawDeployment.effectiveCapabilities.connectors.length} connectors
                </div>
                {selectedZeroClawDeployment.lastError && (
                  <div className="sm:col-span-4 text-status-critical">
                    Error: {selectedZeroClawDeployment.lastError}
                  </div>
                )}
              </div>
            </div>

            {/* Invocation Diagnostics - collapsible */}
            <CollapsibleSection
              title="Invocation Diagnostics"
              badge={
                <span className="text-xs text-muted-foreground">
                  {zeroClawInvocationStats.total} events
                </span>
              }
            >
              <div className="flex flex-wrap items-center gap-4 text-sm text-muted-foreground">
                <span>Streamed: {zeroClawInvocationStats.streamed}</span>
                <span>Fallback: {zeroClawInvocationStats.syntheticFallback}</span>
                <span>Recoveries: {zeroClawInvocationStats.pairedRecoveries}</span>
                <span>Avg latency: {zeroClawInvocationStats.averageDurationMs}ms</span>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Button
                  size="sm"
                  variant="outline"
                  onClick={exportInvocationDiagnosticsJson}
                  disabled={zeroClawInvocations.length === 0}
                >
                  Export JSON
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void exportDiagnosticsBundleJson()}
                >
                  <Download className="mr-1 size-4" />
                  Export Bundle
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => void refreshSelectedDeploymentRuntimeData()}
                >
                  Refresh
                </Button>
                <label className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={autoRefreshDiagnostics}
                    onChange={(e) => setAutoRefreshDiagnostics(e.target.checked)}
                    className="size-4"
                  />
                  Auto-refresh
                </label>
                {lastDiagnosticsRefreshAt && (
                  <span className="text-xs">Last: {formatDate(lastDiagnosticsRefreshAt)}</span>
                )}
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
                <label className="flex items-center gap-2">
                  Transport:
                  <select
                    value={transportFilter}
                    onChange={(e) =>
                      setTransportFilter(
                        e.target.value as "all" | "sse" | "ndjson" | "json" | "unknown"
                      )
                    }
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="all">all</option>
                    <option value="sse">sse</option>
                    <option value="ndjson">ndjson</option>
                    <option value="json">json</option>
                    <option value="unknown">unknown</option>
                  </select>
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={fallbackOnly}
                    onChange={(e) => setFallbackOnly(e.target.checked)}
                    className="size-4"
                  />
                  Fallback only
                </label>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={errorsOnly}
                    onChange={(e) => setErrorsOnly(e.target.checked)}
                    className="size-4"
                  />
                  Errors only
                </label>
                <span className="text-muted-foreground">
                  Showing: {recentZeroClawInvocations.length} / {filteredZeroClawInvocations.length}
                </span>
              </div>

              {zeroClawInvocations.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No invocations yet.</p>
              ) : filteredZeroClawInvocations.length === 0 ? (
                <p className="mt-3 text-sm text-muted-foreground">No matches for filters.</p>
              ) : (
                <div className="mt-3 max-h-48 overflow-auto rounded-md border border-border bg-sidebar p-3 font-mono text-xs">
                  {recentZeroClawInvocations.map((entry) => (
                    <div key={entry.id} className="flex items-start justify-between gap-2 py-0.5">
                      <div
                        className={
                          entry.hasError ? "text-status-critical" : "text-muted-foreground"
                        }
                      >
                        [{formatDate(entry.occurredAt)}] thread={entry.threadId.slice(0, 8)} model=
                        {entry.model} transport={entry.transport} duration={entry.durationMs}ms
                        {entry.hasError && ` error="${entry.errorMessage || "unknown"}"`}
                      </div>
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-5 px-2 text-xs"
                        onClick={() => void openInvocationThread(entry.threadId)}
                      >
                        Open
                      </Button>
                    </div>
                  ))}
                </div>
              )}
            </CollapsibleSection>

            {/* Runtime Events - collapsible */}
            {zeroClawEvents.length > 0 && (
              <CollapsibleSection
                title="Runtime Events"
                badge={
                  <span className="text-xs text-muted-foreground">
                    {zeroClawEvents.length} events
                  </span>
                }
              >
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => void loadOlderRuntimeEvents()}
                    disabled={!zeroClawEventsCursor || isZeroClawBusy}
                  >
                    Load older
                  </Button>
                </div>
                <div className="mt-3 max-h-40 overflow-auto rounded-md border border-border bg-sidebar p-3 font-mono text-xs text-muted-foreground">
                  {zeroClawEvents.slice(0, 60).map((event) => (
                    <div key={event.id}>
                      [{formatDate(event.occurredAt)}] {event.severity.toUpperCase()}{" "}
                      {event.eventType}: {event.message}
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}

            {/* Doctor Report - collapsible */}
            {zeroClawDoctorReport && (
              <CollapsibleSection
                title="Doctor Report"
                badge={
                  <Badge variant={zeroClawDoctorReport.healthy ? "info" : "critical"}>
                    {zeroClawDoctorReport.healthy ? "Healthy" : "Issues"}
                  </Badge>
                }
                defaultOpen
              >
                <p className="text-sm text-muted-foreground">
                  Last run: {formatDate(zeroClawDoctorReport.generatedAt)}
                </p>
                <div className="mt-3 space-y-2">
                  {zeroClawDoctorReport.checks.map((check) => (
                    <div key={check.id} className="rounded-md border border-border p-3">
                      <div className="flex items-center gap-2">
                        <span className={check.ok ? "text-green-500" : "text-status-critical"}>
                          [{check.ok ? "PASS" : "FAIL"}]
                        </span>
                        <span className="font-medium">{check.label}</span>
                      </div>
                      {check.details && (
                        <p className="mt-1 text-sm text-muted-foreground">{check.details}</p>
                      )}
                      {check.repairHint && (
                        <p className="mt-1 text-sm text-muted-foreground">
                          Repair: {check.repairHint}
                        </p>
                      )}
                    </div>
                  ))}
                </div>
              </CollapsibleSection>
            )}
          </>
        )}
      </div>
    </section>
  )
}
