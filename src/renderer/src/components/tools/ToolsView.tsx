import { useCallback, useEffect, useMemo, useState } from "react"
import {
  ChevronDown,
  FlaskConical,
  Plus,
  RefreshCw,
  Save,
  Server,
  ShieldCheck,
  Trash2,
  Wrench
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import type {
  ConnectorDefinition,
  McpServerDefinition,
  SkillDefinition,
  SkillDetail,
  SkillRegistryLocation,
  ToolDefinition
} from "@/types"

interface ToolFormState {
  name: string
  displayName: string
  description: string
  category: ToolDefinition["category"]
  action: ToolDefinition["action"]
  riskTier: ToolDefinition["riskTier"]
  implementationType: ToolDefinition["implementationType"]
  enabled: boolean
  configJson: string
}

const TOOL_CATEGORY_OPTIONS: Array<ToolDefinition["category"]> = [
  "filesystem",
  "execution",
  "network",
  "connector",
  "memory",
  "skills",
  "custom"
]

const TOOL_ACTION_OPTIONS: Array<ToolDefinition["action"]> = ["read", "write", "exec", "post"]
const TOOL_IMPLEMENTATION_OPTIONS: Array<ToolDefinition["implementationType"]> = [
  "script",
  "builtin"
]

function getRiskBadgeVariant(riskTier: number): "outline" | "info" | "warning" | "critical" {
  if (riskTier >= 3) return "critical"
  if (riskTier >= 2) return "warning"
  if (riskTier >= 1) return "info"
  return "outline"
}

function getStatusBadgeVariant(
  status: McpServerDefinition["status"] | ConnectorDefinition["status"]
): "outline" | "info" | "warning" | "critical" {
  if (status === "running" || status === "connected") return "info"
  if (status === "error") return "critical"
  return "outline"
}

function defaultToolForm(): ToolFormState {
  return {
    name: "",
    displayName: "",
    description: "",
    category: "custom",
    action: "exec",
    riskTier: 2,
    implementationType: "script",
    enabled: true,
    configJson: JSON.stringify({ commandTemplate: "" }, null, 2)
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

function toolToForm(tool: ToolDefinition): ToolFormState {
  return {
    name: tool.name,
    displayName: tool.displayName,
    description: tool.description,
    category: tool.category,
    action: tool.action,
    riskTier: tool.riskTier,
    implementationType: tool.implementationType,
    enabled: tool.enabled,
    configJson: JSON.stringify(tool.config || {}, null, 2)
  }
}

function normalizeToolName(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, "_")
}

function formatDate(value: Date | string): string {
  const parsed = value instanceof Date ? value : new Date(value)
  if (!Number.isFinite(parsed.getTime())) return "Unknown"
  return parsed.toLocaleString()
}

function parseToolConfig(configJson: string): Record<string, unknown> {
  const raw = configJson.trim()
  if (!raw) return {}
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed)) throw new Error("Config must be a JSON object.")
  return parsed
}

// Collapsible section component
function CollapsibleSection({
  title,
  icon: Icon,
  defaultOpen = false,
  count,
  children
}: {
  title: string
  icon: React.ComponentType<{ className?: string }>
  defaultOpen?: boolean
  count?: number
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
          <Icon className="size-4 text-muted-foreground" />
          <span className="text-sm font-medium">{title}</span>
          {count !== undefined && <span className="text-xs text-muted-foreground">({count})</span>}
        </div>
        <ChevronDown
          className={cn("size-4 text-muted-foreground transition-transform", open && "rotate-180")}
        />
      </button>
      {open && <div className="border-t border-border px-4 py-3">{children}</div>}
    </div>
  )
}

export function ToolsView(): React.JSX.Element {
  const [connectors, setConnectors] = useState<ConnectorDefinition[]>([])
  const [mcpServers, setMcpServers] = useState<McpServerDefinition[]>([])
  const [skills, setSkills] = useState<SkillDefinition[]>([])
  const [skillLocations, setSkillLocations] = useState<SkillRegistryLocation[]>([])
  const [tools, setTools] = useState<ToolDefinition[]>([])
  const [selectedSkillId, setSelectedSkillId] = useState<string | null>(null)
  const [selectedToolId, setSelectedToolId] = useState<string | null>(null)
  const [selectedSkillDetail, setSelectedSkillDetail] = useState<SkillDetail | null>(null)
  const [isSkillDetailLoading, setIsSkillDetailLoading] = useState(false)
  const [skillDetailStatus, setSkillDetailStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [toolStatus, setToolStatus] = useState<string | null>(null)
  const [isToolSaving, setIsToolSaving] = useState(false)
  const [isToolDeleting, setIsToolDeleting] = useState(false)
  const [isCreatingTool, setIsCreatingTool] = useState(false)
  const [toolFilter, setToolFilter] = useState<"all" | "system" | "custom">("all")
  const [toolForm, setToolForm] = useState<ToolFormState>(defaultToolForm)
  const [selectedToolNameForTest, setSelectedToolNameForTest] = useState("")
  const [testArgsJson, setTestArgsJson] = useState("{}")
  const [testConsoleOutput, setTestConsoleOutput] = useState<string | null>(null)
  const [showAdvancedConfig, setShowAdvancedConfig] = useState(false)

  const selectedTool = useMemo(
    () => tools.find((entry) => entry.id === selectedToolId) || null,
    [selectedToolId, tools]
  )
  const filteredTools = useMemo(() => {
    if (toolFilter === "all") return tools
    return tools.filter((entry) => entry.source === toolFilter)
  }, [toolFilter, tools])

  const load = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    try {
      const [loadedConnectors, loadedMcp, loadedSkills, loadedTools] = await Promise.all([
        window.api.connectors.list(),
        window.api.mcp.list(),
        window.api.skills.list(),
        window.api.tools.list({ includeDisabled: true })
      ])
      setConnectors(loadedConnectors)
      setMcpServers(loadedMcp)
      setSkills(loadedSkills.skills)
      setSkillLocations(loadedSkills.locations)
      setTools(loadedTools)
      setStatus(null)
    } catch (error) {
      setStatus(`Failed to load: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    if (skills.length === 0) {
      setSelectedSkillId(null)
      setSelectedSkillDetail(null)
      return
    }
    const hasSelection = selectedSkillId
      ? skills.some((skill) => skill.id === selectedSkillId)
      : false
    if (!hasSelection) {
      setSelectedSkillId(skills[0].id)
    }
  }, [selectedSkillId, skills])

  useEffect(() => {
    if (!selectedSkillId) {
      setSelectedSkillDetail(null)
      setSkillDetailStatus(null)
      return
    }

    let cancelled = false
    setIsSkillDetailLoading(true)
    setSkillDetailStatus(null)

    void window.api.skills
      .getDetail(selectedSkillId)
      .then((detail) => {
        if (!cancelled) setSelectedSkillDetail(detail)
      })
      .catch((error) => {
        if (!cancelled) {
          setSelectedSkillDetail(null)
          setSkillDetailStatus(
            `Failed to load: ${error instanceof Error ? error.message : "Unknown error"}`
          )
        }
      })
      .finally(() => {
        if (!cancelled) setIsSkillDetailLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [selectedSkillId])

  useEffect(() => {
    if (tools.length === 0) {
      setSelectedToolId(null)
      setSelectedToolNameForTest("")
      return
    }

    const hasSelection = selectedToolId ? tools.some((entry) => entry.id === selectedToolId) : false
    if (!hasSelection && !isCreatingTool) {
      setSelectedToolId(tools[0].id)
    }

    const hasTestTool = tools.some((entry) => entry.name === selectedToolNameForTest)
    if (!hasTestTool) {
      setSelectedToolNameForTest(tools[0].name)
    }
  }, [isCreatingTool, selectedToolId, selectedToolNameForTest, tools])

  useEffect(() => {
    if (!selectedTool || isCreatingTool) return
    setToolForm(toolToForm(selectedTool))
    setToolStatus(null)
  }, [isCreatingTool, selectedTool])

  function startCreateTool(): void {
    setIsCreatingTool(true)
    setSelectedToolId(null)
    setToolStatus("Create a custom tool and save it to register.")
    setToolForm(defaultToolForm())
    setShowAdvancedConfig(true)
  }

  function selectTool(toolId: string): void {
    setIsCreatingTool(false)
    setSelectedToolId(toolId)
    setToolStatus(null)
  }

  async function saveTool(): Promise<void> {
    setIsToolSaving(true)
    setToolStatus(null)

    try {
      const parsedConfig = parseToolConfig(toolForm.configJson)
      const normalizedName = normalizeToolName(toolForm.name)
      const payload = {
        name: normalizedName,
        displayName: toolForm.displayName.trim(),
        description: toolForm.description.trim(),
        category: toolForm.category,
        action: toolForm.action,
        riskTier: toolForm.riskTier,
        implementationType: toolForm.implementationType,
        config: parsedConfig,
        enabled: toolForm.enabled
      } as const

      if (isCreatingTool) {
        const created = await window.api.tools.create(payload)
        setIsCreatingTool(false)
        await load()
        setSelectedToolId(created.id)
        setToolStatus(`Created "${created.name}".`)
        return
      }

      if (!selectedTool) {
        setToolStatus("Select a tool first.")
        return
      }

      if (selectedTool.source === "system") {
        await window.api.tools.update(selectedTool.id, { enabled: toolForm.enabled })
        await load()
        setSelectedToolId(selectedTool.id)
        setToolStatus(`Updated "${selectedTool.name}" enabled state.`)
        return
      }

      await window.api.tools.update(selectedTool.id, payload)
      await load()
      setSelectedToolId(selectedTool.id)
      setToolStatus(`Saved "${normalizeToolName(toolForm.name)}".`)
    } catch (error) {
      setToolStatus(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsToolSaving(false)
    }
  }

  async function deleteSelectedTool(): Promise<void> {
    if (!selectedTool || selectedTool.source !== "custom") return
    const confirmed = window.confirm(`Delete "${selectedTool.name}"?`)
    if (!confirmed) return

    setIsToolDeleting(true)
    setToolStatus(null)
    try {
      await window.api.tools.delete(selectedTool.id)
      await load()
      setSelectedToolId(null)
      setToolStatus(`Deleted "${selectedTool.name}".`)
    } catch (error) {
      setToolStatus(`Failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsToolDeleting(false)
    }
  }

  function runToolTestDryRun(): void {
    try {
      const parsed = JSON.parse(testArgsJson)
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        setTestConsoleOutput("Args must be a JSON object.")
        return
      }
      const argKeys = Object.keys(parsed as Record<string, unknown>)
      setTestConsoleOutput(
        `Safe preview only.\nTool: ${selectedToolNameForTest || "(none)"}\nArgs: ${
          argKeys.length > 0 ? argKeys.join(", ") : "(none)"
        }\nNo command executed.`
      )
    } catch (error) {
      setTestConsoleOutput(`Invalid JSON: ${error instanceof Error ? error.message : "Unknown"}`)
    }
  }

  const editorIsSystemTool = !!selectedTool && selectedTool.source === "system" && !isCreatingTool
  const showDelete = !!selectedTool && selectedTool.source === "custom" && !isCreatingTool

  return (
    <section className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-auto px-8 py-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-semibold">Skills & Tools</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Manage registered tools, skills, and MCP servers
            </p>
          </div>
          <Button size="sm" variant="outline" onClick={() => void load()} disabled={isLoading}>
            <RefreshCw className={cn("mr-2 size-4", isLoading && "animate-spin")} />
            Refresh
          </Button>
        </div>

        {status && (
          <div className="mt-4 rounded-md border border-status-warning/30 bg-status-warning/10 px-4 py-2 text-sm text-status-warning">
            {status}
          </div>
        )}

        <div className="mt-6 flex gap-6">
          {/* Main content */}
          <div className="flex-1 space-y-4">
            {/* Summary row - compact stats */}
            <div className="flex items-center gap-6 text-sm">
              <div className="flex items-center gap-2">
                <ShieldCheck className="size-4 text-muted-foreground" />
                <span className="font-medium">{skills.length}</span>
                <span className="text-muted-foreground">skills</span>
              </div>
              <div className="flex items-center gap-2">
                <Server className="size-4 text-muted-foreground" />
                <span className="font-medium">{mcpServers.length}</span>
                <span className="text-muted-foreground">MCP servers</span>
              </div>
              <div className="flex items-center gap-2">
                <Wrench className="size-4 text-muted-foreground" />
                <span className="font-medium">{tools.length}</span>
                <span className="text-muted-foreground">tools</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-medium">{connectors.length}</span>
                <span className="text-muted-foreground">connectors</span>
              </div>
            </div>

            {/* Skills section - collapsible */}
            <CollapsibleSection
              title="Installed Skills"
              icon={ShieldCheck}
              count={skills.length}
              defaultOpen={skills.length > 0 && skills.length <= 5}
            >
              <div className="space-y-2">
                {skillLocations.length > 0 && (
                  <div className="mb-3 space-y-1">
                    {skillLocations.map((location) => (
                      <div
                        key={location.path}
                        className="flex items-center gap-2 text-xs text-muted-foreground"
                      >
                        <span
                          className={cn(
                            "size-1.5 rounded-full",
                            location.exists ? "bg-green-500" : "bg-muted"
                          )}
                        />
                        <span className="font-medium">{location.source}</span>
                        <span className="truncate">{location.path}</span>
                      </div>
                    ))}
                  </div>
                )}

                {skills.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No skills found. Add skill folders with SKILL.md to ~/.agents/skills
                  </p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2">
                    {skills.map((skill) => (
                      <button
                        key={skill.id}
                        onClick={() => setSelectedSkillId(skill.id)}
                        className={cn(
                          "rounded-md border p-3 text-left transition-colors",
                          selectedSkillId === skill.id
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        )}
                      >
                        <div className="font-medium">{skill.name}</div>
                        <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                          {skill.description}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </CollapsibleSection>

            {/* MCP Servers - collapsible */}
            <CollapsibleSection title="MCP Servers" icon={Server} count={mcpServers.length}>
              {mcpServers.length === 0 ? (
                <p className="text-sm text-muted-foreground">No MCP servers configured.</p>
              ) : (
                <div className="space-y-2">
                  {mcpServers.map((server) => (
                    <div
                      key={server.id}
                      className="flex items-center justify-between rounded-md border border-border p-3"
                    >
                      <div>
                        <div className="font-medium">{server.name}</div>
                        <div className="mt-0.5 truncate text-xs text-muted-foreground">
                          {server.command}
                        </div>
                      </div>
                      <Badge variant={getStatusBadgeVariant(server.status)}>{server.status}</Badge>
                    </div>
                  ))}
                </div>
              )}
            </CollapsibleSection>

            {/* Tool Registry - main focus */}
            <div className="rounded-md border border-border">
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="flex items-center gap-2">
                  <Wrench className="size-4 text-muted-foreground" />
                  <span className="font-medium">Tool Registry</span>
                  <span className="text-sm text-muted-foreground">({filteredTools.length})</span>
                </div>
                <div className="flex items-center gap-2">
                  <select
                    value={toolFilter}
                    onChange={(e) => setToolFilter(e.target.value as "all" | "system" | "custom")}
                    className="h-8 rounded-md border border-input bg-background px-2 text-sm"
                  >
                    <option value="all">All</option>
                    <option value="system">System</option>
                    <option value="custom">Custom</option>
                  </select>
                  <Button size="sm" variant="outline" onClick={startCreateTool}>
                    <Plus className="mr-1 size-4" />
                    New Tool
                  </Button>
                </div>
              </div>

              <div className="max-h-[400px] overflow-auto p-4">
                {filteredTools.length === 0 ? (
                  <p className="text-sm text-muted-foreground">No tools match this filter.</p>
                ) : (
                  <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
                    {filteredTools.map((entry) => (
                      <button
                        key={entry.id}
                        onClick={() => selectTool(entry.id)}
                        className={cn(
                          "rounded-md border p-3 text-left transition-colors",
                          selectedToolId === entry.id && !isCreatingTool
                            ? "border-primary bg-primary/5"
                            : "border-border hover:border-primary/50"
                        )}
                      >
                        <div className="flex items-center justify-between">
                          <span className="truncate font-medium">{entry.name}</span>
                          <Badge variant={getRiskBadgeVariant(entry.riskTier)} className="ml-2">
                            T{entry.riskTier}
                          </Badge>
                        </div>
                        <div className="mt-1 truncate text-xs text-muted-foreground">
                          {entry.displayName}
                        </div>
                        <div className="mt-2 flex items-center gap-2 text-xs text-muted-foreground">
                          <span>{entry.category}</span>
                          <span>•</span>
                          <span>{entry.action}</span>
                          {!entry.enabled && (
                            <>
                              <span>•</span>
                              <span className="text-status-warning">disabled</span>
                            </>
                          )}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>

            {/* Tool Editor - collapsible advanced options */}
            <div className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <span className="font-medium">
                  {isCreatingTool ? "Create Custom Tool" : "Tool Editor"}
                </span>
              </div>

              <div className="space-y-4 p-4">
                {/* Basic fields - always visible */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="form-group">
                    <label className="form-label">Name</label>
                    <Input
                      value={toolForm.name}
                      onChange={(e) =>
                        setToolForm((c) => ({ ...c, name: normalizeToolName(e.target.value) }))
                      }
                      placeholder="my_custom_tool"
                      disabled={editorIsSystemTool}
                    />
                  </div>
                  <div className="form-group">
                    <label className="form-label">Display Name</label>
                    <Input
                      value={toolForm.displayName}
                      onChange={(e) => setToolForm((c) => ({ ...c, displayName: e.target.value }))}
                      placeholder="My Custom Tool"
                      disabled={editorIsSystemTool}
                    />
                  </div>
                </div>

                <div className="form-group">
                  <label className="form-label">Description</label>
                  <textarea
                    value={toolForm.description}
                    onChange={(e) => setToolForm((c) => ({ ...c, description: e.target.value }))}
                    disabled={editorIsSystemTool}
                    rows={2}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                  />
                </div>

                <div className="flex items-center gap-4">
                  <label className="flex items-center gap-2">
                    <input
                      type="checkbox"
                      checked={toolForm.enabled}
                      onChange={(e) => setToolForm((c) => ({ ...c, enabled: e.target.checked }))}
                      className="size-4 rounded border-input"
                    />
                    <span className="text-sm">Enabled in runtime</span>
                  </label>
                </div>

                {/* Advanced options - collapsible */}
                <button
                  onClick={() => setShowAdvancedConfig(!showAdvancedConfig)}
                  className="flex items-center gap-2 text-sm text-muted-foreground hover:text-foreground"
                >
                  <ChevronDown
                    className={cn(
                      "size-4 transition-transform",
                      showAdvancedConfig && "rotate-180"
                    )}
                  />
                  Advanced configuration
                </button>

                {showAdvancedConfig && (
                  <div className="space-y-4 border-t border-border pt-4">
                    <div className="grid gap-4 sm:grid-cols-4">
                      <div className="form-group">
                        <label className="form-label">Category</label>
                        <select
                          value={toolForm.category}
                          onChange={(e) =>
                            setToolForm((c) => ({
                              ...c,
                              category: e.target.value as ToolDefinition["category"]
                            }))
                          }
                          disabled={editorIsSystemTool}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {TOOL_CATEGORY_OPTIONS.map((cat) => (
                            <option key={cat} value={cat}>
                              {cat}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Action</label>
                        <select
                          value={toolForm.action}
                          onChange={(e) =>
                            setToolForm((c) => ({
                              ...c,
                              action: e.target.value as ToolDefinition["action"]
                            }))
                          }
                          disabled={editorIsSystemTool}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {TOOL_ACTION_OPTIONS.map((action) => (
                            <option key={action} value={action}>
                              {action}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Risk Tier</label>
                        <select
                          value={toolForm.riskTier}
                          onChange={(e) =>
                            setToolForm((c) => ({
                              ...c,
                              riskTier: Number(e.target.value) as ToolDefinition["riskTier"]
                            }))
                          }
                          disabled={editorIsSystemTool}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          <option value={0}>Tier 0</option>
                          <option value={1}>Tier 1</option>
                          <option value={2}>Tier 2</option>
                          <option value={3}>Tier 3</option>
                        </select>
                      </div>
                      <div className="form-group">
                        <label className="form-label">Implementation</label>
                        <select
                          value={toolForm.implementationType}
                          onChange={(e) =>
                            setToolForm((c) => ({
                              ...c,
                              implementationType: e.target
                                .value as ToolDefinition["implementationType"]
                            }))
                          }
                          disabled={editorIsSystemTool}
                          className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                        >
                          {TOOL_IMPLEMENTATION_OPTIONS.map((impl) => (
                            <option key={impl} value={impl}>
                              {impl}
                            </option>
                          ))}
                        </select>
                      </div>
                    </div>

                    <div className="form-group">
                      <label className="form-label">Config JSON</label>
                      <textarea
                        value={toolForm.configJson}
                        onChange={(e) => setToolForm((c) => ({ ...c, configJson: e.target.value }))}
                        disabled={editorIsSystemTool}
                        rows={6}
                        className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                        placeholder='{"commandTemplate":"npm test -- {{target}}"}'
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Script tools require <code>commandTemplate</code>. Use{" "}
                        <code>{"{{token}}"}</code> for shell-safe substitution.
                      </p>
                    </div>

                    {!isCreatingTool && selectedTool && (
                      <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                        <div>ID: {selectedTool.id}</div>
                        <div>Source: {selectedTool.source}</div>
                        <div>Created: {formatDate(selectedTool.createdAt)}</div>
                        <div>Updated: {formatDate(selectedTool.updatedAt)}</div>
                      </div>
                    )}
                  </div>
                )}

                {toolStatus && <div className="text-sm text-status-warning">{toolStatus}</div>}

                <div className="flex gap-2">
                  <Button onClick={() => void saveTool()} disabled={isToolSaving}>
                    <Save className="mr-2 size-4" />
                    {isToolSaving ? "Saving..." : "Save"}
                  </Button>
                  {showDelete && (
                    <Button
                      variant="outline"
                      onClick={() => void deleteSelectedTool()}
                      disabled={isToolDeleting}
                    >
                      <Trash2 className="mr-2 size-4" />
                      {isToolDeleting ? "Deleting..." : "Delete"}
                    </Button>
                  )}
                  {isCreatingTool && (
                    <Button
                      variant="outline"
                      onClick={() => {
                        setIsCreatingTool(false)
                        setToolStatus(null)
                        if (tools.length > 0) setSelectedToolId(tools[0].id)
                      }}
                    >
                      Cancel
                    </Button>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Sidebar */}
          <aside className="w-80 shrink-0 space-y-4">
            {/* Skill Detail */}
            <div className="rounded-md border border-border">
              <div className="border-b border-border px-4 py-3">
                <span className="font-medium">Skill Detail</span>
              </div>

              <div className="p-4">
                {!selectedSkillId ? (
                  <p className="text-sm text-muted-foreground">Select a skill to view details.</p>
                ) : isSkillDetailLoading ? (
                  <p className="text-sm text-muted-foreground">Loading...</p>
                ) : skillDetailStatus ? (
                  <p className="text-sm text-status-warning">{skillDetailStatus}</p>
                ) : selectedSkillDetail ? (
                  <div className="space-y-3">
                    <div>
                      <div className="font-medium">{selectedSkillDetail.skill.name}</div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        {selectedSkillDetail.skill.description}
                      </div>
                      <div className="mt-1 text-xs text-muted-foreground">
                        Source: {selectedSkillDetail.skill.source}
                      </div>
                    </div>

                    {selectedSkillDetail.skill.allowedTools.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {selectedSkillDetail.skill.allowedTools.map((toolName) => (
                          <Badge
                            key={`${selectedSkillDetail.skill.id}:${toolName}`}
                            variant="outline"
                          >
                            {toolName}
                          </Badge>
                        ))}
                      </div>
                    )}

                    <pre className="max-h-48 overflow-auto rounded-md border border-border bg-sidebar p-2 font-mono text-xs text-muted-foreground">
                      {selectedSkillDetail.content}
                    </pre>
                  </div>
                ) : null}
              </div>
            </div>

            {/* Test Console - collapsible */}
            <CollapsibleSection title="Test Console" icon={FlaskConical}>
              <div className="space-y-3">
                <p className="text-xs text-muted-foreground">
                  Safe preview sandbox. Does not execute tools.
                </p>

                <div className="form-group">
                  <label className="form-label">Tool</label>
                  <select
                    value={selectedToolNameForTest}
                    onChange={(e) => setSelectedToolNameForTest(e.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm"
                  >
                    {tools.map((entry) => (
                      <option key={entry.id} value={entry.name}>
                        {entry.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="form-group">
                  <label className="form-label">Args JSON</label>
                  <textarea
                    value={testArgsJson}
                    onChange={(e) => setTestArgsJson(e.target.value)}
                    rows={4}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 font-mono text-sm"
                    placeholder='{"path":"README.md"}'
                  />
                </div>

                <Button size="sm" className="w-full" onClick={runToolTestDryRun}>
                  <FlaskConical className="mr-2 size-4" />
                  Run Preview
                </Button>

                {testConsoleOutput && (
                  <pre className="rounded-md border border-border bg-sidebar p-2 font-mono text-xs text-muted-foreground">
                    {testConsoleOutput}
                  </pre>
                )}
              </div>
            </CollapsibleSection>
          </aside>
        </div>
      </div>
    </section>
  )
}
