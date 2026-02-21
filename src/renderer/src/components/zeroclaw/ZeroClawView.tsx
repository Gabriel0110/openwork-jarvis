import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import {
  Bot,
  Download,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Save,
  ShieldCheck,
  Square,
  Trash2
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAppStore } from "@/lib/store"
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
  if (!Number.isFinite(parsed.getTime())) {
    return "Unknown"
  }
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
      if (event.eventType !== "tool_result" && event.eventType !== "error") {
        return false
      }
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
    if (typeof value === "string" && value.length > 0) {
      return "[REDACTED]"
    }
    if (Array.isArray(value)) {
      return value.map(() => "[REDACTED]")
    }
    if (typeof value === "object" && value !== null) {
      return "[REDACTED]"
    }
  }

  if (Array.isArray(value)) {
    return value.map((item) => redactSecrets(item))
  }
  if (typeof value === "object" && value !== null) {
    const result: Record<string, unknown> = {}
    for (const [key, nested] of Object.entries(value)) {
      result[key] = redactSecrets(nested, key)
    }
    return result
  }
  if (typeof value === "string") {
    if (value.startsWith("sk-") || value.startsWith("xox")) {
      return "[REDACTED]"
    }
    return value
  }
  return value
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
      if (transportFilter !== "all" && transportBucket !== transportFilter) {
        return false
      }
      if (fallbackOnly && !entry.syntheticFallbackUsed) {
        return false
      }
      if (errorsOnly && !entry.hasError) {
        return false
      }
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
        if (options?.silent) {
          return
        }
        setZeroClawStatusMessage(
          `Failed loading install activity: ${error instanceof Error ? error.message : "Unknown error"}`
        )
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
        if (available.length === 0) {
          return ""
        }
        if (current && available.includes(current)) {
          return current
        }
        const preferred = available.find((entry) => entry !== status.activeVersion)
        return preferred || available[0]
      })
    } catch (error) {
      setZeroClawStatusMessage(
        `Failed loading ZeroClaw status: ${error instanceof Error ? error.message : "Unknown error"}`
      )
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
      ) {
        return
      }

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
        if (options?.silent) {
          return
        }
        setZeroClawStatusMessage(
          `Failed loading deployment runtime data: ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        )
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
    if (!zeroClawDeploymentFocusId || zeroClawDeployments.length === 0) {
      return
    }

    const focused = zeroClawDeployments.find(
      (deployment) => deployment.id === zeroClawDeploymentFocusId
    )
    if (focused) {
      setIsZeroClawCreatingDeployment(false)
      setSelectedZeroClawDeploymentId(focused.id)
      setZeroClawStatusMessage(`Focused deployment "${focused.name}".`)
    } else {
      setZeroClawStatusMessage("Focused ZeroClaw deployment was not found.")
    }

    setZeroClawDeploymentFocusId(null)
  }, [zeroClawDeploymentFocusId, zeroClawDeployments, setZeroClawDeploymentFocusId])

  useEffect(() => {
    if (!selectedZeroClawDeployment || isZeroClawCreatingDeployment) {
      return
    }

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
    ) {
      return
    }

    void refreshSelectedDeploymentRuntimeData()
  }, [
    isZeroClawCreatingDeployment,
    refreshSelectedDeploymentRuntimeData,
    selectedZeroClawDeployment,
    selectedZeroClawDeploymentId
  ])

  useEffect(() => {
    if (zeroClawInstallActivity?.state !== "running") {
      return
    }
    const timer = setInterval(() => {
      void refreshInstallActivity({ silent: true })
    }, 500)
    return () => {
      clearInterval(timer)
    }
  }, [refreshInstallActivity, zeroClawInstallActivity?.state])

  useEffect(() => {
    if (!installActivityLogRef.current) {
      return
    }
    installActivityLogRef.current.scrollTop = installActivityLogRef.current.scrollHeight
  }, [zeroClawInstallActivity?.lines.length])

  useEffect(() => {
    if (
      !autoRefreshDiagnostics ||
      !selectedZeroClawDeploymentId ||
      !selectedZeroClawDeployment ||
      isZeroClawCreatingDeployment
    ) {
      return
    }

    const timer = setInterval(() => {
      void refreshSelectedDeploymentRuntimeData({ silent: true })
    }, 2500)

    return () => {
      clearInterval(timer)
    }
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
    setZeroClawStatusMessage("Configure and save a new ZeroClaw deployment.")
    setZeroClawForm(defaultZeroClawDeploymentForm())
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
        status.activeVersion
          ? `Installed runtime version ${status.activeVersion}.`
          : "Runtime install completed."
      )
    } catch (error) {
      setZeroClawStatusMessage(
        `Runtime install failed: ${error instanceof Error ? error.message : "Unknown error"}`
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
        `Runtime verify failed: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  async function upgradeZeroClawRuntime(): Promise<void> {
    if (!selectedUpgradeVersion) {
      setZeroClawStatusMessage("Select a runtime version to upgrade.")
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
      setZeroClawStatusMessage(`Upgraded managed runtime to ${selectedUpgradeVersion}.`)
    } catch (error) {
      setZeroClawStatusMessage(
        `Runtime upgrade failed: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  async function copyInstallActivityLog(): Promise<void> {
    if (!zeroClawInstallActivity || zeroClawInstallActivity.lines.length === 0) {
      setZeroClawStatusMessage("No install activity log lines available.")
      return
    }
    const payload = zeroClawInstallActivity.lines
      .map(
        (line) => `[${formatDate(line.occurredAt)}] ${line.stream.toUpperCase()} ${line.message}`
      )
      .join("\n")
    try {
      await navigator.clipboard.writeText(payload)
      setZeroClawStatusMessage("Copied install activity logs to clipboard.")
    } catch (error) {
      setZeroClawStatusMessage(
        `Failed copying install logs: ${error instanceof Error ? error.message : "Unknown error"}`
      )
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
        setZeroClawStatusMessage(`Created deployment "${created.name}".`)
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
      setZeroClawStatusMessage(`Saved deployment "${updated.name}".`)
    } catch (error) {
      setZeroClawStatusMessage(
        `Failed saving deployment: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  async function deleteZeroClawDeployment(): Promise<void> {
    if (!selectedZeroClawDeployment) {
      return
    }
    if (!window.confirm(`Delete ZeroClaw deployment "${selectedZeroClawDeployment.name}"?`)) {
      return
    }

    setIsZeroClawBusy(true)
    try {
      await window.api.zeroclaw.deployment.delete(selectedZeroClawDeployment.id)
      await load()
      setSelectedZeroClawDeploymentId(null)
      setZeroClawStatusMessage(`Deleted deployment "${selectedZeroClawDeployment.name}".`)
    } catch (error) {
      setZeroClawStatusMessage(
        `Failed deleting deployment: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  async function runtimeAction(action: "start" | "stop" | "restart"): Promise<void> {
    if (!selectedZeroClawDeployment) {
      return
    }
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
      setZeroClawStatusMessage(
        `${action[0].toUpperCase()}${action.slice(1)} command sent to ${selectedZeroClawDeployment.name}.`
      )
    } catch (error) {
      setZeroClawStatusMessage(
        `Failed runtime action: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  async function applyRuntimeVersionToDeployment(): Promise<void> {
    if (!selectedZeroClawDeployment) {
      setZeroClawStatusMessage("Select a deployment first.")
      return
    }
    if (!selectedUpgradeVersion) {
      setZeroClawStatusMessage("Select a runtime version first.")
      return
    }
    if (selectedUpgradeVersion === selectedZeroClawDeployment.runtimeVersion) {
      setZeroClawStatusMessage(
        `${selectedZeroClawDeployment.name} already uses runtime ${selectedUpgradeVersion}.`
      )
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
      setZeroClawStatusMessage(
        selectedZeroClawDeployment.status === "running"
          ? `Applied runtime ${selectedUpgradeVersion} to ${selectedZeroClawDeployment.name} and restarted runtime.`
          : `Applied runtime ${selectedUpgradeVersion} to ${selectedZeroClawDeployment.name}.`
      )
    } catch (error) {
      setZeroClawStatusMessage(
        `Failed applying runtime version: ${error instanceof Error ? error.message : "Unknown error"}`
      )
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
        failures.length === 0
          ? "Doctor checks passed."
          : `Doctor found ${failures.length} issue(s): ${failures
              .map((check) => check.label)
              .join(", ")}`
      )
    } catch (error) {
      setZeroClawStatusMessage(
        `Doctor failed: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  async function openInvocationThread(threadId: string): Promise<void> {
    try {
      await selectThread(threadId)
    } catch (error) {
      setZeroClawStatusMessage(
        `Failed opening thread: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  async function loadOlderRuntimeEvents(): Promise<void> {
    if (!selectedZeroClawDeploymentId || !zeroClawEventsCursor) {
      return
    }
    setIsZeroClawBusy(true)
    try {
      const result = await window.api.zeroclaw.logs.get(
        selectedZeroClawDeploymentId,
        zeroClawEventsCursor,
        120
      )
      setZeroClawEvents((current) => {
        const mergedById = new Map<string, ZeroClawRuntimeEvent>()
        for (const entry of current) {
          mergedById.set(entry.id, entry)
        }
        for (const entry of result.events) {
          mergedById.set(entry.id, entry)
        }
        return Array.from(mergedById.values()).sort(
          (left, right) => right.occurredAt.getTime() - left.occurredAt.getTime()
        )
      })
      setZeroClawEventsCursor(result.nextCursor)
    } catch (error) {
      setZeroClawStatusMessage(
        `Failed loading older runtime events: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setIsZeroClawBusy(false)
    }
  }

  function exportInvocationDiagnosticsJson(): void {
    if (!selectedZeroClawDeployment || zeroClawInvocations.length === 0) {
      setZeroClawStatusMessage("No invocation diagnostics available to export.")
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
      const fileName = `zeroclaw-diagnostics-${sanitizeFilename(
        selectedZeroClawDeployment.name || selectedZeroClawDeployment.id
      )}-${exportedAt.replace(/[:.]/g, "-")}.json`
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setZeroClawStatusMessage(`Exported diagnostics JSON (${payload.invocations.length} entries).`)
    } catch (error) {
      setZeroClawStatusMessage(
        `Failed exporting diagnostics: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  async function exportDiagnosticsBundleJson(): Promise<void> {
    if (!selectedZeroClawDeployment) {
      setZeroClawStatusMessage("Select a deployment to export diagnostics.")
      return
    }

    try {
      const exportedAt = new Date().toISOString()
      const report =
        zeroClawDoctorReport ||
        (await window.api.zeroclaw.doctor.run(selectedZeroClawDeployment.id))
      if (!zeroClawDoctorReport) {
        setZeroClawDoctorReport(report)
      }
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
          filters: {
            transport: transportFilter,
            fallbackOnly,
            errorsOnly
          },
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
      const fileName = `zeroclaw-diagnostics-bundle-${sanitizeFilename(
        selectedZeroClawDeployment.name || selectedZeroClawDeployment.id
      )}-${exportedAt.replace(/[:.]/g, "-")}.json`
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })
      const url = URL.createObjectURL(blob)
      const anchor = document.createElement("a")
      anchor.href = url
      anchor.download = fileName
      document.body.appendChild(anchor)
      anchor.click()
      anchor.remove()
      URL.revokeObjectURL(url)
      setZeroClawStatusMessage("Exported diagnostics bundle JSON.")
    } catch (error) {
      setZeroClawStatusMessage(
        `Failed exporting diagnostics bundle: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  return (
    <section className="flex h-full overflow-hidden bg-background">
      <div className="flex flex-1 flex-col overflow-auto p-4">
        <div className="flex items-center justify-between gap-2">
          <div>
            <div className="text-section-header">ZEROCLAW</div>
            <div className="text-xs text-muted-foreground">
              Managed runtime install, deployment policy, lifecycle, and diagnostics.
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void load()}>
            <RefreshCw className="mr-1 size-3.5" />
            {isLoading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        <div className="mt-3 rounded-sm border border-border p-3 text-xs text-muted-foreground">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider">
            <ShieldCheck className="size-3.5" />
            Usage Flow
          </div>
          <div className="mt-1">
            Install runtime, create deployment, save policy/config, then start runtime. Runtime
            health and events are streamed below.
          </div>
        </div>

        <div className="mt-3 rounded-sm border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Bot className="size-3.5" />
              Deployments
            </div>
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={isZeroClawBusy}
                onClick={() => void installZeroClawRuntime()}
              >
                Install Runtime
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                disabled={isZeroClawBusy}
                onClick={() => void verifyZeroClawRuntime()}
              >
                Verify
              </Button>
              <select
                value={selectedUpgradeVersion}
                onChange={(event) => setSelectedUpgradeVersion(event.target.value)}
                className="h-8 rounded-sm border border-input bg-background px-2 text-xs"
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
                className="h-8 text-xs"
                disabled={isZeroClawBusy || !selectedUpgradeVersion}
                onClick={() => void upgradeZeroClawRuntime()}
              >
                Upgrade
              </Button>
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={startCreateZeroClawDeployment}
              >
                <Plus className="mr-1 size-3.5" />
                New Deployment
              </Button>
            </div>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
            <Badge variant={zeroClawStatus?.state === "installed" ? "info" : "outline"}>
              Runtime: {zeroClawStatus?.state || "unknown"}
            </Badge>
            {zeroClawStatus?.activeVersion && (
              <Badge variant="outline">Active: {zeroClawStatus.activeVersion}</Badge>
            )}
            <span>{zeroClawDeployments.length} deployment(s)</span>
          </div>

          <div className="mt-2 rounded-sm border border-border bg-background p-2">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Install Activity
              </div>
              <div className="flex flex-wrap items-center gap-2 text-[11px]">
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
                {zeroClawInstallActivity?.targetVersion && (
                  <Badge variant="outline">target {zeroClawInstallActivity.targetVersion}</Badge>
                )}
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => void refreshInstallActivity()}
                  disabled={isZeroClawBusy && zeroClawInstallActivity?.state === "running"}
                >
                  Refresh feed
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-6 px-2 text-[10px]"
                  onClick={() => void copyInstallActivityLog()}
                  disabled={(zeroClawInstallActivity?.lines.length || 0) === 0}
                >
                  Copy logs
                </Button>
              </div>
            </div>
            <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
              <span>phase: {zeroClawInstallActivity?.phase || "idle"}</span>
              <span>
                started:{" "}
                {zeroClawInstallActivity?.startedAt
                  ? formatDate(zeroClawInstallActivity.startedAt)
                  : "n/a"}
              </span>
              <span>
                updated:{" "}
                {zeroClawInstallActivity?.updatedAt
                  ? formatDate(zeroClawInstallActivity.updatedAt)
                  : "n/a"}
              </span>
              <span>lines: {zeroClawInstallActivity?.lines.length || 0}</span>
            </div>
            <div
              ref={installActivityLogRef}
              className="mt-2 max-h-44 overflow-auto rounded-sm border border-border bg-background p-2 font-mono text-[10px] text-muted-foreground"
            >
              {!zeroClawInstallActivity || zeroClawInstallActivity.lines.length === 0 ? (
                <div>No install activity yet.</div>
              ) : (
                zeroClawInstallActivity.lines.map((line) => (
                  <div
                    key={line.id}
                    className={line.stream === "stderr" ? "text-status-critical" : undefined}
                  >
                    [{formatDate(line.occurredAt)}] {line.stream.toUpperCase()} {line.message}
                  </div>
                ))
              )}
            </div>
            {zeroClawInstallActivity?.lastError && (
              <div className="mt-1 text-[11px] text-status-critical">
                last error: {zeroClawInstallActivity.lastError}
              </div>
            )}
          </div>

          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {zeroClawDeployments.map((deployment) => (
              <button
                key={deployment.id}
                onClick={() => selectZeroClawDeployment(deployment.id)}
                className={`rounded-sm border p-2 text-left text-xs transition-colors ${
                  selectedZeroClawDeploymentId === deployment.id && !isZeroClawCreatingDeployment
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-background-interactive"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate font-medium">{deployment.name}</div>
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
                <div className="mt-1 truncate text-muted-foreground">{deployment.modelName}</div>
                <div className="mt-1 truncate text-[11px] text-muted-foreground">
                  {deployment.workspacePath}
                </div>
              </button>
            ))}
            {zeroClawDeployments.length === 0 && (
              <div className="rounded-sm border border-border p-2 text-xs text-muted-foreground">
                No ZeroClaw deployments configured.
              </div>
            )}
          </div>

          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Name
              </label>
              <Input
                className="mt-1 h-8 text-xs"
                value={zeroClawForm.name}
                onChange={(event) =>
                  setZeroClawForm((current) => ({ ...current, name: event.target.value }))
                }
                placeholder="Coding Automator"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Workspace Path
              </label>
              <Input
                className="mt-1 h-8 text-xs"
                value={zeroClawForm.workspacePath}
                onChange={(event) =>
                  setZeroClawForm((current) => ({ ...current, workspacePath: event.target.value }))
                }
                placeholder="/Users/.../workspace"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Description
              </label>
              <textarea
                value={zeroClawForm.description}
                onChange={(event) =>
                  setZeroClawForm((current) => ({ ...current, description: event.target.value }))
                }
                className="mt-1 h-16 w-full rounded-sm border border-input bg-background px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Model Provider
              </label>
              <select
                value={zeroClawForm.modelProvider}
                onChange={(event) =>
                  setZeroClawForm((current) => ({
                    ...current,
                    modelProvider: event.target
                      .value as ZeroClawDeploymentFormState["modelProvider"]
                  }))
                }
                className="mt-1 h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
              >
                <option value="openai">openai</option>
                <option value="anthropic">anthropic</option>
                <option value="google">google</option>
                <option value="ollama">ollama</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Model
              </label>
              <Input
                className="mt-1 h-8 text-xs"
                value={zeroClawForm.modelName}
                onChange={(event) =>
                  setZeroClawForm((current) => ({ ...current, modelName: event.target.value }))
                }
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Policy Mode
              </label>
              <select
                value={zeroClawForm.policyMode}
                onChange={(event) =>
                  setZeroClawForm((current) => ({
                    ...current,
                    policyMode: event.target.value as ZeroClawCapabilityMode
                  }))
                }
                className="mt-1 h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
              >
                <option value="global_only">global_only</option>
                <option value="global_plus_assigned">global_plus_assigned</option>
                <option value="assigned_only">assigned_only</option>
                <option value="deny_all_except_assigned">deny_all_except_assigned</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Include Global Skills
              </label>
              <label className="mt-1 flex h-8 items-center gap-2 rounded-sm border border-input bg-background px-2 text-xs">
                <input
                  type="checkbox"
                  checked={zeroClawForm.includeGlobalSkills}
                  onChange={(event) =>
                    setZeroClawForm((current) => ({
                      ...current,
                      includeGlobalSkills: event.target.checked
                    }))
                  }
                  className="size-3.5"
                />
                Enabled
              </label>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Assigned Skills (csv ids)
              </label>
              <Input
                className="mt-1 h-8 text-xs"
                value={zeroClawForm.assignedSkillIdsCsv}
                onChange={(event) =>
                  setZeroClawForm((current) => ({
                    ...current,
                    assignedSkillIdsCsv: event.target.value
                  }))
                }
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Assigned Tools (csv)
              </label>
              <Input
                className="mt-1 h-8 text-xs"
                value={zeroClawForm.assignedToolNamesCsv}
                onChange={(event) =>
                  setZeroClawForm((current) => ({
                    ...current,
                    assignedToolNamesCsv: event.target.value
                  }))
                }
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Assigned Connectors (csv)
              </label>
              <Input
                className="mt-1 h-8 text-xs"
                value={zeroClawForm.assignedConnectorKeysCsv}
                onChange={(event) =>
                  setZeroClawForm((current) => ({
                    ...current,
                    assignedConnectorKeysCsv: event.target.value
                  }))
                }
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Denied Tools (csv)
              </label>
              <Input
                className="mt-1 h-8 text-xs"
                value={zeroClawForm.deniedToolNamesCsv}
                onChange={(event) =>
                  setZeroClawForm((current) => ({
                    ...current,
                    deniedToolNamesCsv: event.target.value
                  }))
                }
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Denied Connectors (csv)
              </label>
              <Input
                className="mt-1 h-8 text-xs"
                value={zeroClawForm.deniedConnectorKeysCsv}
                onChange={(event) =>
                  setZeroClawForm((current) => ({
                    ...current,
                    deniedConnectorKeysCsv: event.target.value
                  }))
                }
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Desired Runtime
              </label>
              <label className="mt-1 flex h-8 items-center gap-2 rounded-sm border border-input bg-background px-2 text-xs">
                <input
                  type="checkbox"
                  checked={zeroClawForm.autoStart}
                  onChange={(event) =>
                    setZeroClawForm((current) => ({ ...current, autoStart: event.target.checked }))
                  }
                  className="size-3.5"
                />
                Auto-start / running
              </label>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              className="h-8 text-xs"
              disabled={isZeroClawBusy}
              onClick={() => void saveZeroClawDeployment()}
            >
              <Save className="mr-1 size-3.5" />
              {isZeroClawBusy
                ? "Working..."
                : isZeroClawCreatingDeployment
                  ? "Create Deployment"
                  : "Save Deployment"}
            </Button>
            {!isZeroClawCreatingDeployment && selectedZeroClawDeployment && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={isZeroClawBusy}
                  onClick={() => void runtimeAction("start")}
                >
                  <Play className="mr-1 size-3.5" />
                  Start
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={isZeroClawBusy}
                  onClick={() => void runtimeAction("stop")}
                >
                  <Square className="mr-1 size-3.5" />
                  Stop
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={isZeroClawBusy}
                  onClick={() => void runtimeAction("restart")}
                >
                  <RotateCcw className="mr-1 size-3.5" />
                  Restart
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
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
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={isZeroClawBusy}
                  onClick={() => void runZeroClawDoctor()}
                >
                  Doctor
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  className="h-8 text-xs"
                  disabled={isZeroClawBusy}
                  onClick={() => void deleteZeroClawDeployment()}
                >
                  <Trash2 className="mr-1 size-3.5" />
                  Delete
                </Button>
              </>
            )}
            {isZeroClawCreatingDeployment && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
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

          {(selectedZeroClawDeployment || isZeroClawCreatingDeployment) && (
            <div className="mt-3 rounded-sm border border-border bg-background p-2 text-xs">
              {!isZeroClawCreatingDeployment && selectedZeroClawDeployment && (
                <div className="grid gap-1 md:grid-cols-2">
                  <div>Status: {selectedZeroClawDeployment.status}</div>
                  <div>Desired: {selectedZeroClawDeployment.desiredState}</div>
                  <div>Runtime: {selectedZeroClawDeployment.runtimeVersion}</div>
                  <div>Endpoint: {selectedZeroClawDeployment.apiBaseUrl}</div>
                  <div>
                    Health:{" "}
                    {zeroClawHealth
                      ? `${zeroClawHealth.status}${zeroClawHealth.latencyMs ? ` (${zeroClawHealth.latencyMs}ms)` : ""}`
                      : "unknown"}
                  </div>
                  <div>Last error: {selectedZeroClawDeployment.lastError || "(none)"}</div>
                  <div>
                    Effective: {selectedZeroClawDeployment.effectiveCapabilities.skills.length}{" "}
                    skills, {selectedZeroClawDeployment.effectiveCapabilities.tools.length} tools,{" "}
                    {selectedZeroClawDeployment.effectiveCapabilities.connectors.length} connectors
                  </div>
                  <div>
                    Gates:{" "}
                    {Object.entries(selectedZeroClawDeployment.effectiveCapabilities.gates)
                      .filter(([, enabled]) => enabled)
                      .map(([gate]) => gate)
                      .join(", ") || "(none)"}
                  </div>
                </div>
              )}
              {!isZeroClawCreatingDeployment && selectedZeroClawDeployment && (
                <div className="mt-2 rounded-sm border border-border p-2">
                  <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
                    Recent Chat Invocations
                  </div>
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <Badge variant="outline">{zeroClawInvocationStats.total} events</Badge>
                    <Badge variant="outline">showing {recentZeroClawInvocations.length}</Badge>
                    <span>streamed: {zeroClawInvocationStats.streamed}</span>
                    <span>synthetic fallback: {zeroClawInvocationStats.syntheticFallback}</span>
                    <span>paired recoveries: {zeroClawInvocationStats.pairedRecoveries}</span>
                    <span>avg latency: {zeroClawInvocationStats.averageDurationMs}ms</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      onClick={exportInvocationDiagnosticsJson}
                      disabled={zeroClawInvocations.length === 0}
                    >
                      Export JSON
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => void exportDiagnosticsBundleJson()}
                    >
                      <Download className="mr-1 size-3" />
                      Export Bundle
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-6 px-2 text-[10px]"
                      onClick={() => void refreshSelectedDeploymentRuntimeData()}
                    >
                      Refresh diagnostics
                    </Button>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={autoRefreshDiagnostics}
                        onChange={(event) => setAutoRefreshDiagnostics(event.target.checked)}
                        className="size-3.5"
                      />
                      auto refresh
                    </label>
                    <span>
                      last refresh:{" "}
                      {lastDiagnosticsRefreshAt ? formatDate(lastDiagnosticsRefreshAt) : "not yet"}
                    </span>
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                    <label className="flex items-center gap-1">
                      Transport
                      <select
                        value={transportFilter}
                        onChange={(event) =>
                          setTransportFilter(
                            event.target.value as "all" | "sse" | "ndjson" | "json" | "unknown"
                          )
                        }
                        className="h-6 rounded-sm border border-input bg-background px-1 text-[10px]"
                      >
                        <option value="all">all</option>
                        <option value="sse">sse</option>
                        <option value="ndjson">ndjson</option>
                        <option value="json">json</option>
                        <option value="unknown">unknown</option>
                      </select>
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={fallbackOnly}
                        onChange={(event) => setFallbackOnly(event.target.checked)}
                        className="size-3.5"
                      />
                      fallback only
                    </label>
                    <label className="flex items-center gap-1">
                      <input
                        type="checkbox"
                        checked={errorsOnly}
                        onChange={(event) => setErrorsOnly(event.target.checked)}
                        className="size-3.5"
                      />
                      errors only
                    </label>
                    <span>matching: {filteredZeroClawInvocations.length}</span>
                  </div>
                  {zeroClawInvocations.length === 0 ? (
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      No invocation events yet for this deployment.
                    </div>
                  ) : filteredZeroClawInvocations.length === 0 ? (
                    <div className="mt-2 text-[11px] text-muted-foreground">
                      No invocations match the current diagnostics filters.
                    </div>
                  ) : (
                    <div className="mt-2 max-h-52 overflow-auto rounded-sm border border-border bg-background p-2 font-mono text-[10px] text-muted-foreground">
                      {recentZeroClawInvocations.map((entry) => (
                        <div
                          key={entry.id}
                          className="flex items-start justify-between gap-2 py-0.5"
                        >
                          <div>
                            [{formatDate(entry.occurredAt)}] thread={entry.threadId.slice(0, 8)}{" "}
                            model=
                            {entry.model} transport={entry.transport} duration={entry.durationMs}ms
                            chunks={entry.tokenChunks} streamed={entry.streamed ? "yes" : "no"}{" "}
                            fallback=
                            {entry.syntheticFallbackUsed ? "yes" : "no"} retries=
                            {entry.attemptCount}
                            {entry.pairingRecovered ? " paired-recover" : ""}
                            {entry.hasError ? ` error="${entry.errorMessage || "unknown"}"` : ""}
                          </div>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-5 px-1.5 text-[10px]"
                            onClick={() => void openInvocationThread(entry.threadId)}
                          >
                            Open
                          </Button>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
              {!isZeroClawCreatingDeployment && zeroClawEvents.length > 0 && (
                <div className="mt-2 rounded-sm border border-border p-2 font-mono text-[10px] text-muted-foreground">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span>Runtime log events: {zeroClawEvents.length}</span>
                    <Button
                      size="sm"
                      variant="outline"
                      className="h-5 px-1.5 text-[10px]"
                      onClick={() => void loadOlderRuntimeEvents()}
                      disabled={!zeroClawEventsCursor || isZeroClawBusy}
                    >
                      Load older
                    </Button>
                  </div>
                  <div className="max-h-40 overflow-auto">
                    {zeroClawEvents.slice(0, 60).map((event) => (
                      <div key={event.id}>
                        [{formatDate(event.occurredAt)}] {event.severity.toUpperCase()}{" "}
                        {event.eventType}: {event.message}
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {zeroClawDoctorReport && !isZeroClawCreatingDeployment && (
                <div className="mt-2 rounded-sm border border-border p-2 text-[11px] text-muted-foreground">
                  <div className="mb-1 uppercase tracking-wider">Doctor Checks</div>
                  <div className="mb-2">
                    Last run: {formatDate(zeroClawDoctorReport.generatedAt)} | healthy:{" "}
                    {zeroClawDoctorReport.healthy ? "yes" : "no"}
                  </div>
                  <div className="space-y-1">
                    {zeroClawDoctorReport.checks.map((check) => (
                      <div
                        key={check.id}
                        className="rounded-sm border border-border bg-background p-1.5"
                      >
                        <div>
                          [{check.ok ? "PASS" : "FAIL"}] {check.label}
                        </div>
                        {check.details && <div className="mt-0.5">{check.details}</div>}
                        {check.repairHint && (
                          <div className="mt-0.5">repair: {check.repairHint}</div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {zeroClawStatusMessage && (
            <div className="mt-2 text-xs text-status-warning">{zeroClawStatusMessage}</div>
          )}
        </div>
      </div>
    </section>
  )
}
