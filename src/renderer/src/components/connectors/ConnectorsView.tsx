import { useCallback, useEffect, useMemo, useState } from "react"
import { Cable, ChevronDown, Copy, FileDown, FileUp, RefreshCw, Server, Trash2 } from "lucide-react"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/lib/store"
import { cn } from "@/lib/utils"
import type {
  ConnectorExportBundle,
  ConnectorCategory,
  ConnectorDefinition,
  McpServerDefinition,
  TimelineEvent
} from "@/types"

const DEFAULT_WORKSPACE_ID = "default-workspace"

const CONNECTOR_CATEGORIES: ConnectorCategory[] = [
  "messaging",
  "dev",
  "social",
  "email",
  "webhook",
  "custom"
]

function toPrettyStatus(value: string): string {
  return value.replace(/_/g, " ")
}

function parseConnectorKey(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_")
}

function toEventTimestamp(value: Date | string | number | undefined): number {
  if (value instanceof Date) return value.getTime()
  if (typeof value === "number" && Number.isFinite(value)) return value
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    return Number.isFinite(parsed) ? parsed : 0
  }
  return 0
}

function getEventConnectorKey(event: TimelineEvent): string | null {
  const toolName = String(event.toolName || "").toLowerCase()
  const prefixes = ["connector:", "connector_", "connector-"]
  for (const prefix of prefixes) {
    if (toolName.startsWith(prefix)) {
      const key = parseConnectorKey(toolName.slice(prefix.length))
      return key || null
    }
  }
  const payload = event.payload || {}
  const candidates = [payload.connectorKey, payload.sourceConnectorKey, payload.connector]
  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const key = parseConnectorKey(candidate)
      if (key) return key
    }
  }
  return null
}

function getConnectorRateLimitPerHour(connector: ConnectorDefinition): number | null {
  const value = connector.config?.rateLimitPerHour
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return Math.floor(value)
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10)
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null
  }
  return null
}

interface ConnectorActivitySummary {
  calls24h: number
  errors24h: number
  lastEventAt?: number
  recentEvents: Array<{
    id: string
    summary: string
    occurredAt: number
    eventType: string
  }>
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
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="mt-3 border-t border-border pt-3">
      <button
        onClick={() => setOpen(!open)}
        className="flex w-full items-center justify-between text-left text-xs text-muted-foreground hover:text-foreground"
      >
        <span>{title}</span>
        <ChevronDown className={cn("size-3.5 transition-transform", open && "rotate-180")} />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  )
}

export function ConnectorsView(): React.JSX.Element {
  const { agents, threads, currentThreadId, loadAgents, updateAgent } = useAppStore()
  const [connectors, setConnectors] = useState<ConnectorDefinition[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerDefinition[]>([])
  const [workspaceEvents, setWorkspaceEvents] = useState<TimelineEvent[]>([])
  const [rateLimitDrafts, setRateLimitDrafts] = useState<Record<string, string>>({})
  const [busyMessage, setBusyMessage] = useState<string | null>(null)
  const [bundleStatus, setBundleStatus] = useState<string | null>(null)
  const [bundleFormat, setBundleFormat] = useState<"json" | "yaml">("json")
  const [bundleJson, setBundleJson] = useState("")
  const [showTestEvent, setShowTestEvent] = useState(false)
  const [showImportExport, setShowImportExport] = useState(false)
  const [isLoading, setIsLoading] = useState(false)

  const [connectorKey, setConnectorKey] = useState("")
  const [connectorName, setConnectorName] = useState("")
  const [connectorCategory, setConnectorCategory] = useState<ConnectorCategory>("custom")

  const [mcpName, setMcpName] = useState("")
  const [mcpCommand, setMcpCommand] = useState("")
  const [mcpArgs, setMcpArgs] = useState("")
  const [testThreadId, setTestThreadId] = useState("")
  const [testEventKey, setTestEventKey] = useState("test.event")
  const [testPayloadJson, setTestPayloadJson] = useState('{"sample": true}')

  const workspaceId = useMemo(() => agents[0]?.workspaceId || DEFAULT_WORKSPACE_ID, [agents])

  const normalizeConnectorKey = useCallback((value: string): string => {
    return value.trim().toLowerCase().replace(/\s+/g, "_")
  }, [])

  const loadData = useCallback(async () => {
    setIsLoading(true)
    try {
      const [connectorsResponse, mcpResponse] = await Promise.all([
        window.api.connectors.list(workspaceId),
        window.api.mcp.list(workspaceId)
      ])
      setConnectors(connectorsResponse)
      setMcpServers(mcpResponse)
      setRateLimitDrafts((previous) => {
        const next: Record<string, string> = {}
        for (const connector of connectorsResponse) {
          const existing = previous[connector.id]
          if (typeof existing === "string") {
            next[connector.id] = existing
          } else {
            const currentLimit = getConnectorRateLimitPerHour(connector)
            next[connector.id] = currentLimit ? String(currentLimit) : ""
          }
        }
        return next
      })
    } finally {
      setIsLoading(false)
    }
  }, [workspaceId])

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  useEffect(() => {
    void loadData()
  }, [loadData])

  useEffect(() => {
    let cancelled = false
    const loadWorkspaceEvents = async (): Promise<void> => {
      try {
        const events = await window.api.timeline.listWorkspace(workspaceId, 400)
        if (!cancelled) setWorkspaceEvents(events)
      } catch {
        // Silently fail
      }
    }
    void loadWorkspaceEvents()
    const timer = setInterval(() => void loadWorkspaceEvents(), 15_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [workspaceId])

  useEffect(() => {
    if (testThreadId) return
    if (currentThreadId) {
      setTestThreadId(currentThreadId)
      return
    }
    if (threads.length > 0) setTestThreadId(threads[0].thread_id)
  }, [currentThreadId, testThreadId, threads])

  const createConnector = async (): Promise<void> => {
    const key = connectorKey.trim()
    const name = connectorName.trim()
    if (!key || !name) return
    setBusyMessage("Creating...")
    try {
      await window.api.connectors.create({
        workspaceId,
        key,
        name,
        category: connectorCategory,
        enabled: true,
        status: "disconnected"
      })
      setConnectorKey("")
      setConnectorName("")
      await loadData()
    } finally {
      setBusyMessage(null)
    }
  }

  const toggleConnector = async (connector: ConnectorDefinition): Promise<void> => {
    setBusyMessage(`${connector.enabled ? "Disabling" : "Enabling"}...`)
    try {
      await window.api.connectors.update(connector.id, { enabled: !connector.enabled })
      await loadData()
    } finally {
      setBusyMessage(null)
    }
  }

  const deleteConnector = async (connectorId: string): Promise<void> => {
    setBusyMessage("Removing...")
    try {
      await window.api.connectors.delete(connectorId)
      await loadData()
    } finally {
      setBusyMessage(null)
    }
  }

  const sendConnectorTestEvent = async (connector: ConnectorDefinition): Promise<void> => {
    const targetThreadId = testThreadId || currentThreadId || threads[0]?.thread_id || ""
    if (!targetThreadId) {
      setBusyMessage("Select a thread first.")
      return
    }

    const eventKey = testEventKey.trim() || "test.event"
    let payload: Record<string, unknown> = {}
    if (testPayloadJson.trim()) {
      try {
        const parsed = JSON.parse(testPayloadJson)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setBusyMessage("Payload must be a JSON object.")
          return
        }
        payload = parsed as Record<string, unknown>
      } catch (error) {
        setBusyMessage(`Invalid JSON: ${error instanceof Error ? error.message : "Unknown"}`)
        return
      }
    }

    setBusyMessage(`Sending test event...`)
    try {
      await window.api.timeline.ingestTriggerEvent({
        threadId: targetThreadId,
        workspaceId,
        triggerType: "connector_event",
        eventType: "tool_result",
        eventKey,
        sourceKey: connector.key,
        toolName: `connector:${connector.key}`,
        summary: `Test event (${connector.key}:${eventKey})`,
        payload: {
          ...payload,
          connectorId: connector.id,
          connectorName: connector.name,
          simulatedBy: "connectors-view"
        }
      })
      setBusyMessage(`Test event sent to thread ${targetThreadId.slice(0, 8)}.`)
    } catch (error) {
      setBusyMessage(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    }
  }

  const toggleAgentConnectorAccess = async (
    agentId: string,
    connectorKeyRaw: string,
    currentlyAllowed: boolean
  ): Promise<void> => {
    const agent = agents.find((item) => item.id === agentId)
    if (!agent) return

    const connKey = normalizeConnectorKey(connectorKeyRaw)
    const currentAllowlist = new Set(agent.connectorAllowlist.map((i) => normalizeConnectorKey(i)))
    if (currentlyAllowed) {
      currentAllowlist.delete(connKey)
    } else {
      currentAllowlist.add(connKey)
    }

    setBusyMessage(`Updating access...`)
    try {
      await updateAgent(agent.id, { connectorAllowlist: Array.from(currentAllowlist).sort() })
      await loadAgents()
      setBusyMessage(`${currentlyAllowed ? "Revoked" : "Granted"} ${connKey} for ${agent.name}.`)
    } catch (error) {
      setBusyMessage(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    }
  }

  const connectorActivityByKey = useMemo(() => {
    const sortedEvents = [...workspaceEvents].sort(
      (left, right) => toEventTimestamp(right.occurredAt) - toEventTimestamp(left.occurredAt)
    )
    const nowMs = Date.now()
    const cutoff = nowMs - 24 * 60 * 60 * 1000
    const summaries = new Map<string, ConnectorActivitySummary>()

    for (const event of sortedEvents) {
      const connKey = getEventConnectorKey(event)
      if (!connKey) continue
      const occurredAt = toEventTimestamp(event.occurredAt)
      const existing = summaries.get(connKey) || { calls24h: 0, errors24h: 0, recentEvents: [] }
      if (!existing.lastEventAt || occurredAt > existing.lastEventAt)
        existing.lastEventAt = occurredAt
      if (occurredAt >= cutoff) {
        existing.calls24h += 1
        if (event.eventType === "error") existing.errors24h += 1
      }
      if (existing.recentEvents.length < 3) {
        existing.recentEvents.push({
          id: event.id,
          summary: (event.summary || `${event.eventType} ${event.toolName || ""}`).trim(),
          occurredAt,
          eventType: event.eventType
        })
      }
      summaries.set(connKey, existing)
    }
    return summaries
  }, [workspaceEvents])

  const saveConnectorRateLimit = async (connector: ConnectorDefinition): Promise<void> => {
    const raw = (rateLimitDrafts[connector.id] || "").trim()
    if (!raw) {
      const nextConfig = { ...(connector.config || {}) }
      delete nextConfig.rateLimitPerHour
      setBusyMessage("Clearing rate limit...")
      try {
        await window.api.connectors.update(connector.id, { config: nextConfig })
        await loadData()
        setBusyMessage("Rate limit cleared.")
      } catch (error) {
        setBusyMessage(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
      }
      return
    }

    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setBusyMessage("Rate limit must be a positive number.")
      return
    }

    const nextConfig = { ...(connector.config || {}), rateLimitPerHour: parsed }
    setBusyMessage("Saving rate limit...")
    try {
      await window.api.connectors.update(connector.id, { config: nextConfig })
      await loadData()
      setBusyMessage(`Rate limit: ${parsed}/hour.`)
    } catch (error) {
      setBusyMessage(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    }
  }

  const createMcpServer = async (): Promise<void> => {
    const name = mcpName.trim()
    const command = mcpCommand.trim()
    if (!name || !command) return
    const args = mcpArgs
      .split(" ")
      .map((p) => p.trim())
      .filter(Boolean)

    setBusyMessage("Creating MCP server...")
    try {
      await window.api.mcp.create({
        workspaceId,
        name,
        command,
        args,
        enabled: true,
        status: "stopped"
      })
      setMcpName("")
      setMcpCommand("")
      setMcpArgs("")
      await loadData()
    } finally {
      setBusyMessage(null)
    }
  }

  const toggleMcpServer = async (server: McpServerDefinition): Promise<void> => {
    setBusyMessage(`${server.enabled ? "Disabling" : "Enabling"}...`)
    try {
      await window.api.mcp.update(server.id, { enabled: !server.enabled })
      await loadData()
    } finally {
      setBusyMessage(null)
    }
  }

  const deleteMcpServer = async (serverId: string): Promise<void> => {
    setBusyMessage("Removing...")
    try {
      await window.api.mcp.delete(serverId)
      await loadData()
    } finally {
      setBusyMessage(null)
    }
  }

  const exportConnectorBundle = async (format: "json" | "yaml" = bundleFormat): Promise<void> => {
    setBundleStatus("Exporting...")
    try {
      const bundle = await window.api.connectors.exportBundle(workspaceId, false)
      const serialized = format === "yaml" ? stringifyYaml(bundle) : JSON.stringify(bundle, null, 2)
      setBundleJson(serialized)
      setBundleFormat(format)
      setBundleStatus(`Exported (${format}). Secrets redacted.`)
    } catch (error) {
      setBundleStatus(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    }
  }

  const importConnectorBundle = async (): Promise<void> => {
    if (!bundleJson.trim()) return
    setBundleStatus("Importing...")
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

      const normalized = parsed as ConnectorExportBundle
      if (
        !normalized ||
        typeof normalized !== "object" ||
        !Array.isArray((normalized as { connectors?: unknown[] }).connectors) ||
        !Array.isArray((normalized as { mcpServers?: unknown[] }).mcpServers)
      ) {
        throw new Error("Invalid format.")
      }

      const imported = await window.api.connectors.importBundle(normalized, workspaceId)
      await loadData()
      setBundleStatus(
        `Imported ${imported.connectors.length} connectors, ${imported.mcpServers.length} MCP servers.`
      )
    } catch (error) {
      setBundleStatus(`Failed: ${error instanceof Error ? error.message : "Unknown"}`)
    }
  }

  const copyConnectorBundle = async (): Promise<void> => {
    if (!bundleJson.trim()) return
    try {
      await navigator.clipboard.writeText(bundleJson)
      setBundleStatus("Copied to clipboard.")
    } catch {
      setBundleStatus("Copy failed.")
    }
  }

  return (
    <section className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-auto px-8 py-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Connectors</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Integrations, MCP servers, and connector policies
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void loadData()} disabled={isLoading}>
            <RefreshCw className={cn("mr-2 size-4", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {busyMessage && (
          <div className="mt-4 rounded-md border border-border bg-sidebar px-4 py-2 text-sm text-muted-foreground">
            {busyMessage}
          </div>
        )}

        <div className="mt-6 flex gap-6">
          {/* Main content */}
          <div className="flex-1 space-y-4">
            {/* Stats row */}
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <Cable className="size-4 text-muted-foreground" />
                <span className="font-medium">{connectors.length}</span>
                <span className="text-muted-foreground">connectors</span>
              </div>
              <div className="flex items-center gap-2">
                <Server className="size-4 text-muted-foreground" />
                <span className="font-medium">{mcpServers.length}</span>
                <span className="text-muted-foreground">MCP servers</span>
              </div>
            </div>

            {/* Add Connector */}
            <div className="rounded-md border border-border p-4">
              <div className="text-sm font-medium">Add Connector</div>
              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <input
                  value={connectorKey}
                  onChange={(e) => setConnectorKey(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="Key (e.g., github)"
                />
                <input
                  value={connectorName}
                  onChange={(e) => setConnectorName(e.target.value)}
                  className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                  placeholder="Display name"
                />
                <div className="flex gap-2">
                  <select
                    value={connectorCategory}
                    onChange={(e) => setConnectorCategory(e.target.value as ConnectorCategory)}
                    className="h-9 flex-1 rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {CONNECTOR_CATEGORIES.map((cat) => (
                      <option key={cat} value={cat}>
                        {cat}
                      </option>
                    ))}
                  </select>
                  <Button onClick={() => void createConnector()}>Create</Button>
                </div>
              </div>
            </div>

            {/* Connectors list */}
            <div className="rounded-md border border-border">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <Cable className="size-4 text-muted-foreground" />
                  <span className="font-medium">Connectors</span>
                </div>
                <button
                  onClick={() => setShowTestEvent(!showTestEvent)}
                  className="text-xs text-muted-foreground hover:text-foreground"
                >
                  {showTestEvent ? "Hide" : "Show"} test event form
                </button>
              </div>

              {showTestEvent && (
                <div className="border-b border-border bg-sidebar p-4">
                  <div className="text-sm font-medium">Send Test Event</div>
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <select
                      value={testThreadId}
                      onChange={(e) => setTestThreadId(e.target.value)}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="">Select thread</option>
                      {threads.map((thread) => (
                        <option key={thread.thread_id} value={thread.thread_id}>
                          {thread.title || thread.thread_id.slice(0, 8)}
                        </option>
                      ))}
                    </select>
                    <input
                      value={testEventKey}
                      onChange={(e) => setTestEventKey(e.target.value)}
                      className="h-9 rounded-md border border-input bg-background px-3 text-sm"
                      placeholder="Event key (e.g., issue.created)"
                    />
                  </div>
                  <textarea
                    value={testPayloadJson}
                    onChange={(e) => setTestPayloadJson(e.target.value)}
                    className="mt-2 h-16 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                    placeholder='{"id":"evt_123"}'
                  />
                </div>
              )}

              <div className="p-4">
                {connectors.length === 0 ? (
                  <div className="py-8 text-center text-sm text-muted-foreground">
                    <Cable className="mx-auto mb-2 size-6 opacity-50" />
                    No connectors configured
                  </div>
                ) : (
                  <div className="space-y-3">
                    {connectors.map((connector) => {
                      const connKey = parseConnectorKey(connector.key)
                      const activity = connectorActivityByKey.get(connKey)
                      const currentRateLimit = getConnectorRateLimitPerHour(connector)
                      const draftRateLimit = rateLimitDrafts[connector.id] ?? ""
                      const calls24h = activity?.calls24h || 0
                      const errors24h = activity?.errors24h || 0
                      const isOverRateLimit = Boolean(
                        currentRateLimit && calls24h > currentRateLimit
                      )

                      return (
                        <div key={connector.id} className="rounded-md border border-border p-4">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2">
                                <span className="font-medium">{connector.name}</span>
                                <Badge variant={connector.enabled ? "info" : "outline"}>
                                  {connector.enabled ? "Enabled" : "Disabled"}
                                </Badge>
                              </div>
                              <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
                                <span>Key: {connector.key}</span>
                                <span>•</span>
                                <span>{connector.category}</span>
                                <span>•</span>
                                <span>{toPrettyStatus(connector.status)}</span>
                              </div>
                            </div>
                            <div className="flex gap-2">
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void toggleConnector(connector)}
                              >
                                {connector.enabled ? "Disable" : "Enable"}
                              </Button>
                              {showTestEvent && (
                                <Button
                                  size="sm"
                                  variant="outline"
                                  onClick={() => void sendConnectorTestEvent(connector)}
                                >
                                  Send Test
                                </Button>
                              )}
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() => void deleteConnector(connector.id)}
                              >
                                <Trash2 className="size-4" />
                              </Button>
                            </div>
                          </div>

                          {/* Collapsible: Rate Limits */}
                          <CollapsibleSection title="Rate limits & activity">
                            <div className="flex items-center gap-4 text-xs">
                              <span className={isOverRateLimit ? "text-status-critical" : ""}>
                                Calls (24h): {calls24h}
                              </span>
                              <span className={errors24h > 0 ? "text-status-warning" : ""}>
                                Errors: {errors24h}
                              </span>
                              <span>
                                Limit: {currentRateLimit ? `${currentRateLimit}/hr` : "none"}
                              </span>
                            </div>
                            <div className="mt-2 flex items-center gap-2">
                              <input
                                value={draftRateLimit}
                                onChange={(e) => {
                                  const value = e.target.value.replace(/[^0-9]/g, "")
                                  setRateLimitDrafts((p) => ({ ...p, [connector.id]: value }))
                                }}
                                className="h-8 w-32 rounded-md border border-input bg-background px-2 text-sm"
                                placeholder="calls/hour"
                              />
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() => void saveConnectorRateLimit(connector)}
                              >
                                Save
                              </Button>
                            </div>
                            {(activity?.recentEvents || []).length > 0 && (
                              <div className="mt-2 space-y-1">
                                {activity?.recentEvents.map((event) => (
                                  <div
                                    key={event.id}
                                    className="rounded border border-border px-2 py-1 text-xs text-muted-foreground"
                                  >
                                    <div className="truncate">{event.summary}</div>
                                    <div className="mt-0.5 text-[10px]">
                                      {new Date(event.occurredAt).toLocaleString()} •{" "}
                                      {event.eventType}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </CollapsibleSection>

                          {/* Collapsible: Agent Access */}
                          <CollapsibleSection title="Agent access">
                            {agents.length === 0 ? (
                              <p className="text-xs text-muted-foreground">No agents available.</p>
                            ) : (
                              <div className="space-y-1">
                                {agents.map((agent) => {
                                  const normalizedKey = normalizeConnectorKey(connector.key)
                                  const allowed = agent.connectorAllowlist
                                    .map((k) => normalizeConnectorKey(k))
                                    .includes(normalizedKey)
                                  return (
                                    <div
                                      key={agent.id}
                                      className="flex items-center justify-between rounded border border-border px-2 py-1.5"
                                    >
                                      <div>
                                        <span className="text-sm font-medium">{agent.name}</span>
                                        <span className="ml-2 text-xs text-muted-foreground">
                                          {agent.role}
                                        </span>
                                      </div>
                                      <Button
                                        size="sm"
                                        variant={allowed ? "default" : "outline"}
                                        onClick={() =>
                                          void toggleAgentConnectorAccess(
                                            agent.id,
                                            connector.key,
                                            allowed
                                          )
                                        }
                                      >
                                        {allowed ? "Allowed" : "Denied"}
                                      </Button>
                                    </div>
                                  )
                                })}
                              </div>
                            )}
                          </CollapsibleSection>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="w-80 shrink-0 space-y-4">
            {/* MCP Servers */}
            <div className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <span className="font-medium">MCP Servers</span>
              </div>

              <div className="p-4">
                <div className="space-y-2">
                  <input
                    value={mcpName}
                    onChange={(e) => setMcpName(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    placeholder="Server name"
                  />
                  <input
                    value={mcpCommand}
                    onChange={(e) => setMcpCommand(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    placeholder="Command (e.g., npx)"
                  />
                  <input
                    value={mcpArgs}
                    onChange={(e) => setMcpArgs(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    placeholder="Args (space-separated)"
                  />
                  <Button className="w-full" onClick={() => void createMcpServer()}>
                    Add Server
                  </Button>
                </div>

                {mcpServers.length === 0 ? (
                  <p className="mt-4 text-sm text-muted-foreground">No MCP servers configured.</p>
                ) : (
                  <div className="mt-4 space-y-2">
                    {mcpServers.map((server) => (
                      <div key={server.id} className="rounded-md border border-border p-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className="font-medium">{server.name}</span>
                              <Badge variant={server.enabled ? "info" : "outline"}>
                                {server.enabled ? "On" : "Off"}
                              </Badge>
                            </div>
                            <div className="mt-1 truncate text-xs text-muted-foreground">
                              {server.command} {server.args.join(" ")}
                            </div>
                            {server.lastError && (
                              <div className="mt-1 text-xs text-status-critical">
                                {server.lastError}
                              </div>
                            )}
                          </div>
                          <Button
                            size="sm"
                            variant="ghost"
                            onClick={() => void deleteMcpServer(server.id)}
                          >
                            <Trash2 className="size-4" />
                          </Button>
                        </div>
                        <Button
                          size="sm"
                          variant="outline"
                          className="mt-2"
                          onClick={() => void toggleMcpServer(server)}
                        >
                          {server.enabled ? "Disable" : "Enable"}
                        </Button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Import/Export */}
            <div className="rounded-md border border-border">
              <button
                onClick={() => setShowImportExport(!showImportExport)}
                className="flex w-full items-center justify-between px-4 py-3 text-left hover:bg-background-interactive"
              >
                <span className="font-medium">Import / Export</span>
                <ChevronDown
                  className={cn("size-4 text-muted-foreground", showImportExport && "rotate-180")}
                />
              </button>

              {showImportExport && (
                <div className="border-t border-border p-4">
                  <p className="text-xs text-muted-foreground">
                    Export/import connector + MCP bundles. Secrets are redacted on export.
                  </p>

                  <div className="mt-3 flex gap-2">
                    <Button
                      size="sm"
                      className="flex-1"
                      onClick={() => void exportConnectorBundle(bundleFormat)}
                    >
                      <FileDown className="mr-1 size-4" />
                      Export
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      onClick={() => void importConnectorBundle()}
                    >
                      <FileUp className="mr-1 size-4" />
                      Import
                    </Button>
                  </div>

                  <div className="mt-2">
                    <select
                      value={bundleFormat}
                      onChange={(e) => setBundleFormat(e.target.value as "json" | "yaml")}
                      className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                    >
                      <option value="json">JSON</option>
                      <option value="yaml">YAML</option>
                    </select>
                  </div>

                  <textarea
                    value={bundleJson}
                    onChange={(e) => setBundleJson(e.target.value)}
                    className="mt-2 h-40 w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-xs"
                    placeholder="Paste JSON or YAML to import"
                  />

                  <Button
                    size="sm"
                    variant="outline"
                    className="mt-2"
                    disabled={!bundleJson.trim()}
                    onClick={() => void copyConnectorBundle()}
                  >
                    <Copy className="mr-1 size-4" />
                    Copy
                  </Button>

                  {bundleStatus && (
                    <p className="mt-2 text-xs text-muted-foreground">{bundleStatus}</p>
                  )}
                </div>
              )}
            </div>
          </aside>
        </div>
      </div>
    </section>
  )
}
