import { useCallback, useEffect, useMemo, useState } from "react"
import { Cable, Copy, FileDown, FileUp, PlugZap, Server, Trash2 } from "lucide-react"
import { parse as parseYaml, stringify as stringifyYaml } from "yaml"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/lib/store"
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
  const connectorKeyCandidates = [
    payload.connectorKey,
    payload.sourceConnectorKey,
    payload.connector
  ]
  for (const candidate of connectorKeyCandidates) {
    if (typeof candidate === "string") {
      const key = parseConnectorKey(candidate)
      if (key) {
        return key
      }
    }
  }
  return null
}

function getConnectorRateLimitPerHour(connector: ConnectorDefinition): number | null {
  const value = connector.config?.rateLimitPerHour
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value)
  }
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
        if (!cancelled) {
          setWorkspaceEvents(events)
        }
      } catch (error) {
        console.warn("[Connectors] Failed to load connector activity logs.", error)
      }
    }

    void loadWorkspaceEvents()
    const timer = setInterval(() => {
      void loadWorkspaceEvents()
    }, 15_000)

    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [workspaceId])

  useEffect(() => {
    if (testThreadId) {
      return
    }

    if (currentThreadId) {
      setTestThreadId(currentThreadId)
      return
    }

    if (threads.length > 0) {
      setTestThreadId(threads[0].thread_id)
    }
  }, [currentThreadId, testThreadId, threads])

  const createConnector = async (): Promise<void> => {
    const key = connectorKey.trim()
    const name = connectorName.trim()
    if (!key || !name) {
      return
    }
    setBusyMessage("Creating connector...")
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
    setBusyMessage(`${connector.enabled ? "Disabling" : "Enabling"} connector...`)
    try {
      await window.api.connectors.update(connector.id, {
        enabled: !connector.enabled
      })
      await loadData()
    } finally {
      setBusyMessage(null)
    }
  }

  const deleteConnector = async (connectorId: string): Promise<void> => {
    setBusyMessage("Removing connector...")
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
      setBusyMessage("Select a thread before sending a test trigger event.")
      return
    }

    const eventKey = testEventKey.trim() || "test.event"
    let payload: Record<string, unknown> = {}
    if (testPayloadJson.trim()) {
      try {
        const parsed = JSON.parse(testPayloadJson)
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          setBusyMessage("Test payload must be a JSON object.")
          return
        }
        payload = parsed as Record<string, unknown>
      } catch (error) {
        setBusyMessage(
          `Invalid test payload JSON: ${error instanceof Error ? error.message : "Unknown error"}`
        )
        return
      }
    }

    setBusyMessage(`Sending ${connector.key} trigger test event...`)
    try {
      await window.api.timeline.ingestTriggerEvent({
        threadId: targetThreadId,
        workspaceId,
        triggerType: "connector_event",
        eventType: "tool_result",
        eventKey,
        sourceKey: connector.key,
        toolName: `connector:${connector.key}`,
        summary: `Connector test event (${connector.key}:${eventKey})`,
        payload: {
          ...payload,
          connectorId: connector.id,
          connectorName: connector.name,
          simulatedBy: "connectors-view"
        }
      })
      setBusyMessage(
        `Test event emitted for ${connector.name} in thread ${targetThreadId.slice(0, 8)}.`
      )
    } catch (error) {
      setBusyMessage(
        `Failed to emit test event: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  const toggleAgentConnectorAccess = async (
    agentId: string,
    connectorKeyRaw: string,
    currentlyAllowed: boolean
  ): Promise<void> => {
    const agent = agents.find((item) => item.id === agentId)
    if (!agent) {
      return
    }

    const connectorKey = normalizeConnectorKey(connectorKeyRaw)
    const currentAllowlist = new Set(
      agent.connectorAllowlist.map((item) => normalizeConnectorKey(item))
    )
    if (currentlyAllowed) {
      currentAllowlist.delete(connectorKey)
    } else {
      currentAllowlist.add(connectorKey)
    }

    setBusyMessage(
      `${currentlyAllowed ? "Revoking" : "Granting"} ${connectorKey} access for ${agent.name}...`
    )
    try {
      await updateAgent(agent.id, {
        connectorAllowlist: Array.from(currentAllowlist).sort()
      })
      await loadAgents()
      setBusyMessage(
        `${currentlyAllowed ? "Revoked" : "Granted"} ${connectorKey} access for ${agent.name}.`
      )
    } catch (error) {
      setBusyMessage(
        `Failed to update connector access: ${error instanceof Error ? error.message : "Unknown error"}`
      )
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
      const connectorKey = getEventConnectorKey(event)
      if (!connectorKey) {
        continue
      }

      const occurredAt = toEventTimestamp(event.occurredAt)
      const existing = summaries.get(connectorKey) || {
        calls24h: 0,
        errors24h: 0,
        recentEvents: []
      }

      if (!existing.lastEventAt || occurredAt > existing.lastEventAt) {
        existing.lastEventAt = occurredAt
      }
      if (occurredAt >= cutoff) {
        existing.calls24h += 1
        if (event.eventType === "error") {
          existing.errors24h += 1
        }
      }
      if (existing.recentEvents.length < 3) {
        existing.recentEvents.push({
          id: event.id,
          summary: (event.summary || `${event.eventType} ${event.toolName || ""}`).trim(),
          occurredAt,
          eventType: event.eventType
        })
      }
      summaries.set(connectorKey, existing)
    }

    return summaries
  }, [workspaceEvents])

  const saveConnectorRateLimit = async (connector: ConnectorDefinition): Promise<void> => {
    const raw = (rateLimitDrafts[connector.id] || "").trim()
    if (!raw) {
      const nextConfig = { ...(connector.config || {}) }
      delete nextConfig.rateLimitPerHour
      setBusyMessage(`Clearing rate limit for ${connector.name}...`)
      try {
        await window.api.connectors.update(connector.id, { config: nextConfig })
        await loadData()
        setBusyMessage(`Rate limit cleared for ${connector.name}.`)
      } catch (error) {
        setBusyMessage(
          `Failed to clear rate limit: ${error instanceof Error ? error.message : "Unknown error"}`
        )
      }
      return
    }

    const parsed = Number.parseInt(raw, 10)
    if (!Number.isFinite(parsed) || parsed <= 0) {
      setBusyMessage("Rate limit must be a positive whole number per hour.")
      return
    }

    const nextConfig = {
      ...(connector.config || {}),
      rateLimitPerHour: parsed
    }
    setBusyMessage(`Saving rate limit for ${connector.name}...`)
    try {
      await window.api.connectors.update(connector.id, { config: nextConfig })
      await loadData()
      setBusyMessage(`Rate limit saved for ${connector.name}: ${parsed}/hour.`)
    } catch (error) {
      setBusyMessage(
        `Failed to save rate limit: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  const createMcpServer = async (): Promise<void> => {
    const name = mcpName.trim()
    const command = mcpCommand.trim()
    if (!name || !command) {
      return
    }
    const args = mcpArgs
      .split(" ")
      .map((part) => part.trim())
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
    setBusyMessage(`${server.enabled ? "Disabling" : "Enabling"} MCP server...`)
    try {
      await window.api.mcp.update(server.id, {
        enabled: !server.enabled
      })
      await loadData()
    } finally {
      setBusyMessage(null)
    }
  }

  const deleteMcpServer = async (serverId: string): Promise<void> => {
    setBusyMessage("Removing MCP server...")
    try {
      await window.api.mcp.delete(serverId)
      await loadData()
    } finally {
      setBusyMessage(null)
    }
  }

  const exportConnectorBundle = async (format: "json" | "yaml" = bundleFormat): Promise<void> => {
    setBundleStatus(`Exporting connector pack (${format})...`)
    try {
      const bundle = await window.api.connectors.exportBundle(workspaceId, false)
      const serialized = format === "yaml" ? stringifyYaml(bundle) : JSON.stringify(bundle, null, 2)
      setBundleJson(serialized)
      setBundleFormat(format)
      setBundleStatus(`Connector pack exported (${format}). Secrets are redacted.`)
    } catch (error) {
      setBundleStatus(
        `Failed to export connector pack: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  const importConnectorBundle = async (): Promise<void> => {
    if (!bundleJson.trim()) {
      return
    }

    setBundleStatus(`Importing connector pack (${bundleFormat})...`)
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
        throw new Error("Invalid connector pack format.")
      }

      const imported = await window.api.connectors.importBundle(normalized, workspaceId)
      await loadData()
      setBundleStatus(
        `Imported ${imported.connectors.length} connectors and ${imported.mcpServers.length} MCP servers.`
      )
    } catch (error) {
      setBundleStatus(
        `Failed to import connector pack: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  const copyConnectorBundle = async (): Promise<void> => {
    if (!bundleJson.trim()) {
      return
    }

    try {
      await navigator.clipboard.writeText(bundleJson)
      setBundleStatus(`Connector pack ${bundleFormat.toUpperCase()} copied to clipboard.`)
    } catch {
      setBundleStatus("Clipboard copy failed.")
    }
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-border">
        <div className="border-b border-border px-4 py-3">
          <div className="text-section-header">CONNECTORS</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Workspace: {workspaceId}. Integrations are permissioned by agent allowlists and policy
            rules.
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 overflow-auto p-4 xl:grid-cols-[340px_1fr]">
          <div className="rounded-sm border border-border p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Add Connector
            </div>
            <div className="space-y-2">
              <input
                value={connectorKey}
                onChange={(event) => setConnectorKey(event.target.value)}
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                placeholder="connector key (e.g., github)"
              />
              <input
                value={connectorName}
                onChange={(event) => setConnectorName(event.target.value)}
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                placeholder="display name"
              />
              <select
                value={connectorCategory}
                onChange={(event) => setConnectorCategory(event.target.value as ConnectorCategory)}
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
              >
                {CONNECTOR_CATEGORIES.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
              <Button size="sm" className="h-8 w-full" onClick={createConnector}>
                Create connector
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <div className="rounded-sm border border-border/60 bg-sidebar p-3">
              <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Trigger Test Event
              </div>
              <div className="mt-1 text-[11px] text-muted-foreground">
                Emit connector events into a thread to test template trigger matching.
              </div>
              <div className="mt-2 space-y-2">
                <select
                  value={testThreadId}
                  onChange={(event) => setTestThreadId(event.target.value)}
                  className="h-7 w-full rounded-sm border border-input bg-background px-2 text-[11px]"
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
                  onChange={(event) => setTestEventKey(event.target.value)}
                  className="h-7 w-full rounded-sm border border-input bg-background px-2 text-[11px]"
                  placeholder="event key (e.g., issue.created)"
                />
                <textarea
                  value={testPayloadJson}
                  onChange={(event) => setTestPayloadJson(event.target.value)}
                  className="h-16 w-full rounded-sm border border-input bg-background px-2 py-1 font-mono text-[11px]"
                  placeholder='payload JSON object, e.g. {"id":"evt_123"}'
                />
              </div>
            </div>

            {connectors.length === 0 ? (
              <div className="rounded-sm border border-border p-6 text-center text-sm text-muted-foreground">
                <Cable className="mx-auto mb-2 size-5 opacity-60" />
                No connectors configured.
              </div>
            ) : (
              connectors.map((connector) => {
                const connectorKey = parseConnectorKey(connector.key)
                const activity = connectorActivityByKey.get(connectorKey)
                const currentRateLimit = getConnectorRateLimitPerHour(connector)
                const draftRateLimit = rateLimitDrafts[connector.id] ?? ""
                const calls24h = activity?.calls24h || 0
                const errors24h = activity?.errors24h || 0
                const isOverRateLimit = Boolean(currentRateLimit && calls24h > currentRateLimit)

                return (
                  <div key={connector.id} className="rounded-sm border border-border p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium">{connector.name}</div>
                        <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                          <Badge variant={connector.enabled ? "nominal" : "outline"}>
                            {connector.enabled ? "Enabled" : "Disabled"}
                          </Badge>
                          <Badge variant="outline">{connector.category}</Badge>
                          <Badge variant="outline">{toPrettyStatus(connector.status)}</Badge>
                          <span>Key: {connector.key}</span>
                        </div>
                      </div>
                      <Button
                        variant="ghost"
                        size="icon-sm"
                        className="size-7"
                        onClick={() => {
                          void deleteConnector(connector.id)
                        }}
                      >
                        <Trash2 className="size-3.5" />
                      </Button>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 h-7 text-xs"
                      onClick={() => {
                        void toggleConnector(connector)
                      }}
                    >
                      {connector.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      className="mt-2 ml-2 h-7 text-xs"
                      onClick={() => {
                        void sendConnectorTestEvent(connector)
                      }}
                    >
                      Send test event
                    </Button>

                    <div className="mt-3 rounded-sm border border-border/60 bg-sidebar p-2">
                      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Rate Limits + Logs
                      </div>
                      <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Badge variant={isOverRateLimit ? "critical" : "outline"}>
                          Calls (24h): {calls24h}
                        </Badge>
                        <Badge variant={errors24h > 0 ? "warning" : "outline"}>
                          Errors (24h): {errors24h}
                        </Badge>
                        <Badge variant={currentRateLimit ? "info" : "outline"}>
                          Limit: {currentRateLimit ? `${currentRateLimit}/hour` : "none"}
                        </Badge>
                      </div>
                      <div className="mt-2 flex items-center gap-2">
                        <input
                          value={draftRateLimit}
                          onChange={(event) => {
                            const value = event.target.value.replace(/[^0-9]/g, "")
                            setRateLimitDrafts((previous) => ({
                              ...previous,
                              [connector.id]: value
                            }))
                          }}
                          className="h-7 w-36 rounded-sm border border-input bg-background px-2 text-[11px]"
                          placeholder="max calls / hour"
                        />
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-[11px]"
                          onClick={() => {
                            void saveConnectorRateLimit(connector)
                          }}
                        >
                          Save limit
                        </Button>
                      </div>
                      <div className="mt-2 space-y-1">
                        {(activity?.recentEvents || []).length === 0 ? (
                          <div className="text-[11px] text-muted-foreground">
                            No connector activity events yet.
                          </div>
                        ) : (
                          activity?.recentEvents.map((event) => (
                            <div
                              key={`${connector.id}:${event.id}`}
                              className="rounded-sm border border-border/60 px-2 py-1 text-[11px] text-muted-foreground"
                            >
                              <div className="truncate">{event.summary}</div>
                              <div className="mt-0.5 text-[10px]">
                                {new Date(event.occurredAt).toLocaleString()} • {event.eventType}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>

                    <div className="mt-3 rounded-sm border border-border/60 bg-sidebar p-2">
                      <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                        Agent Access ({connector.key})
                      </div>
                      <div className="mt-2 space-y-1">
                        {agents.length === 0 && (
                          <div className="text-[11px] text-muted-foreground">
                            No agents available.
                          </div>
                        )}
                        {agents.map((agent) => {
                          const normalizedConnectorKey = normalizeConnectorKey(connector.key)
                          const allowed = agent.connectorAllowlist
                            .map((key) => normalizeConnectorKey(key))
                            .includes(normalizedConnectorKey)

                          return (
                            <div
                              key={`${connector.id}:${agent.id}`}
                              className="flex items-center justify-between gap-2 rounded-sm border border-border/60 px-2 py-1"
                            >
                              <div className="min-w-0">
                                <div className="truncate text-xs font-medium">{agent.name}</div>
                                <div className="text-[10px] text-muted-foreground">
                                  {agent.role}
                                </div>
                              </div>
                              <Button
                                size="sm"
                                variant={allowed ? "default" : "outline"}
                                className="h-6 text-[10px]"
                                onClick={() => {
                                  void toggleAgentConnectorAccess(agent.id, connector.key, allowed)
                                }}
                              >
                                {allowed ? "Allowed" : "Denied"}
                              </Button>
                            </div>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )
              })
            )}
          </div>
        </div>
      </section>

      <aside className="flex w-[360px] flex-col overflow-auto bg-sidebar p-4">
        <div className="mb-3">
          <div className="text-section-header">MCP SERVERS</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Track local MCP endpoints and map their tools into future connector routing.
          </div>
        </div>

        <div className="rounded-sm border border-border p-3">
          <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
            Add MCP Server
          </div>
          <div className="space-y-2">
            <input
              value={mcpName}
              onChange={(event) => setMcpName(event.target.value)}
              className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
              placeholder="server name"
            />
            <input
              value={mcpCommand}
              onChange={(event) => setMcpCommand(event.target.value)}
              className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
              placeholder="command (e.g., npx)"
            />
            <input
              value={mcpArgs}
              onChange={(event) => setMcpArgs(event.target.value)}
              className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
              placeholder="args (space-separated)"
            />
            <Button size="sm" className="h-8 w-full" onClick={createMcpServer}>
              Add MCP server
            </Button>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {mcpServers.length === 0 ? (
            <div className="rounded-sm border border-border p-3 text-xs text-muted-foreground">
              No MCP servers configured.
            </div>
          ) : (
            mcpServers.map((server) => (
              <div key={server.id} className="rounded-sm border border-border p-3">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{server.name}</div>
                    <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Badge variant={server.enabled ? "nominal" : "outline"}>
                        {server.enabled ? "Enabled" : "Disabled"}
                      </Badge>
                      <Badge variant="outline">{toPrettyStatus(server.status)}</Badge>
                    </div>
                    <div className="mt-1 truncate text-[11px] text-muted-foreground">
                      {server.command} {server.args.join(" ")}
                    </div>
                    {server.lastError && (
                      <div className="mt-1 text-[11px] text-status-critical">
                        {server.lastError}
                      </div>
                    )}
                  </div>
                  <Button
                    variant="ghost"
                    size="icon-sm"
                    className="size-7"
                    onClick={() => {
                      void deleteMcpServer(server.id)
                    }}
                  >
                    <Trash2 className="size-3.5" />
                  </Button>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="mt-2 h-7 text-xs"
                  onClick={() => {
                    void toggleMcpServer(server)
                  }}
                >
                  <PlugZap className="mr-1 size-3.5" />
                  {server.enabled ? "Disable" : "Enable"}
                </Button>
              </div>
            ))
          )}
        </div>

        <div className="mt-4 rounded-sm border border-border p-3">
          <div className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
            Connector Packs
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Export/import connector + MCP config bundles. Secret-like keys are redacted on export.
          </div>

          <div className="mt-3 flex gap-2">
            <Button
              size="sm"
              className="h-8 flex-1"
              onClick={() => {
                void exportConnectorBundle(bundleFormat)
              }}
            >
              <FileDown className="mr-1 size-3.5" />
              Export
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="h-8 flex-1"
              onClick={importConnectorBundle}
            >
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
            className="mt-3 h-52 w-full rounded-sm border border-input bg-background px-2 py-1 font-mono text-[11px]"
            placeholder="Exported connector pack appears here. Paste JSON or YAML to import."
          />

          <Button
            size="sm"
            variant="outline"
            className="mt-2 h-8"
            disabled={!bundleJson.trim()}
            onClick={copyConnectorBundle}
          >
            <Copy className="mr-1 size-3.5" />
            Copy
          </Button>

          {bundleStatus && (
            <div className="mt-2 rounded-sm border border-border/60 bg-background px-2 py-1.5 text-[11px] text-muted-foreground">
              {bundleStatus}
            </div>
          )}
        </div>

        {busyMessage && (
          <div className="mt-3 rounded-sm border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
            <Server className="mr-1 inline size-3.5" />
            {busyMessage}
          </div>
        )}
      </aside>
    </div>
  )
}
