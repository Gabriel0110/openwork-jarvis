import { useCallback, useEffect, useMemo, useState } from "react"
import {
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
  if (riskTier >= 3) {
    return "critical"
  }
  if (riskTier >= 2) {
    return "warning"
  }
  if (riskTier >= 1) {
    return "info"
  }
  return "outline"
}

function getStatusBadgeVariant(
  status: McpServerDefinition["status"] | ConnectorDefinition["status"]
): "outline" | "info" | "warning" | "critical" {
  if (status === "running" || status === "connected") {
    return "info"
  }
  if (status === "error") {
    return "critical"
  }
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
  if (!Number.isFinite(parsed.getTime())) {
    return "Unknown"
  }
  return parsed.toLocaleString()
}

function parseToolConfig(configJson: string): Record<string, unknown> {
  const raw = configJson.trim()
  if (!raw) {
    return {}
  }
  const parsed = JSON.parse(raw) as unknown
  if (!isRecord(parsed)) {
    throw new Error("Config must be a JSON object.")
  }
  return parsed
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

  const selectedTool = useMemo(
    () => tools.find((entry) => entry.id === selectedToolId) || null,
    [selectedToolId, tools]
  )
  const filteredTools = useMemo(() => {
    if (toolFilter === "all") {
      return tools
    }
    return tools.filter((entry) => entry.source === toolFilter)
  }, [toolFilter, tools])

  const installedConnectorKeys = useMemo(
    () =>
      connectors
        .map((connector) => connector.key)
        .filter((key) => key.trim().length > 0)
        .sort((left, right) => left.localeCompare(right)),
    [connectors]
  )

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
      setStatus(
        `Failed to load tool surfaces: ${error instanceof Error ? error.message : "Unknown error"}`
      )
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
        if (!cancelled) {
          setSelectedSkillDetail(detail)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSelectedSkillDetail(null)
          setSkillDetailStatus(
            `Failed to load skill detail: ${error instanceof Error ? error.message : "Unknown error"}`
          )
        }
      })
      .finally(() => {
        if (!cancelled) {
          setIsSkillDetailLoading(false)
        }
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
    if (!selectedTool || isCreatingTool) {
      return
    }

    setToolForm(toolToForm(selectedTool))
    setToolStatus(null)
  }, [isCreatingTool, selectedTool])

  function startCreateTool(): void {
    setIsCreatingTool(true)
    setSelectedToolId(null)
    setToolStatus("Create a custom tool and save it to register in this workspace.")
    setToolForm(defaultToolForm())
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
        setToolStatus(`Created custom tool "${created.name}".`)
        return
      }

      if (!selectedTool) {
        setToolStatus("Select a tool first.")
        return
      }

      if (selectedTool.source === "system") {
        await window.api.tools.update(selectedTool.id, {
          enabled: toolForm.enabled
        })
        await load()
        setSelectedToolId(selectedTool.id)
        setToolStatus(`Updated system tool "${selectedTool.name}" enabled state.`)
        return
      }

      await window.api.tools.update(selectedTool.id, payload)
      await load()
      setSelectedToolId(selectedTool.id)
      setToolStatus(`Saved custom tool "${normalizeToolName(toolForm.name)}".`)
    } catch (error) {
      setToolStatus(
        `Failed to save tool: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setIsToolSaving(false)
    }
  }

  async function deleteSelectedTool(): Promise<void> {
    if (!selectedTool || selectedTool.source !== "custom") {
      return
    }

    const confirmed = window.confirm(`Delete custom tool "${selectedTool.name}"?`)
    if (!confirmed) {
      return
    }

    setIsToolDeleting(true)
    setToolStatus(null)
    try {
      await window.api.tools.delete(selectedTool.id)
      await load()
      setSelectedToolId(null)
      setToolStatus(`Deleted custom tool "${selectedTool.name}".`)
    } catch (error) {
      setToolStatus(
        `Failed to delete tool: ${error instanceof Error ? error.message : "Unknown error"}`
      )
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
        `Safe sandbox preview only.\nTool: ${selectedToolNameForTest || "(none)"}\nArgs keys: ${
          argKeys.length > 0 ? argKeys.join(", ") : "(none)"
        }\nNo command was executed.`
      )
    } catch (error) {
      setTestConsoleOutput(
        `Invalid JSON args: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  const editorIsSystemTool = !!selectedTool && selectedTool.source === "system" && !isCreatingTool
  const showDelete = !!selectedTool && selectedTool.source === "custom" && !isCreatingTool

  return (
    <section className="flex h-full overflow-hidden bg-background">
      <div className="flex flex-1 flex-col overflow-auto p-4">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-section-header">SKILLS / TOOLS</div>
            <div className="text-xs text-muted-foreground">
              Registry, MCP servers, custom tools, and sandbox previews.
            </div>
          </div>
          <Button size="sm" variant="outline" className="h-8 text-xs" onClick={() => void load()}>
            <RefreshCw className="mr-1 size-3.5" />
            {isLoading ? "Refreshing..." : "Refresh"}
          </Button>
        </div>

        {status && <div className="mt-2 text-xs text-status-warning">{status}</div>}

        <div className="mt-4 grid gap-3 xl:grid-cols-3">
          <div className="rounded-sm border border-border p-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Installed Skills
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {skills.length} detected skill(s)
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {skillLocations.map((location) => (
                <Badge
                  key={`${location.source}:${location.path}`}
                  variant={location.exists ? "info" : "outline"}
                  title={location.path}
                >
                  {location.source}
                </Badge>
              ))}
            </div>
            <div className="mt-1 space-y-0.5">
              {skillLocations.map((location) => (
                <div key={location.path} className="truncate text-[10px] text-muted-foreground">
                  {location.path}
                </div>
              ))}
            </div>
            <div className="mt-2 max-h-44 space-y-1 overflow-auto pr-1">
              {skills.length === 0 && (
                <div className="rounded-sm border border-border p-2 text-xs text-muted-foreground">
                  No skills found. Add skill folders with a SKILL.md in ~/.agents/skills.
                </div>
              )}
              {skills.map((skill) => (
                <button
                  key={skill.id}
                  onClick={() => setSelectedSkillId(skill.id)}
                  className={`w-full rounded-sm border px-2 py-1.5 text-left text-xs transition-colors ${
                    selectedSkillId === skill.id
                      ? "border-primary bg-primary/10"
                      : "border-border hover:bg-background-interactive"
                  }`}
                >
                  <div className="truncate font-medium">{skill.name}</div>
                  <div className="mt-0.5 line-clamp-2 text-[11px] text-muted-foreground">
                    {skill.description}
                  </div>
                </button>
              ))}
            </div>
          </div>

          <div className="rounded-sm border border-border p-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Server className="size-3.5" />
              MCP Servers
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {mcpServers.length} configured server(s)
            </div>
            <div className="mt-2 space-y-2">
              {mcpServers.length === 0 && (
                <div className="rounded-sm border border-border p-2 text-xs text-muted-foreground">
                  No MCP servers configured.
                </div>
              )}
              {mcpServers.map((server) => (
                <div key={server.id} className="rounded-sm border border-border p-2 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <div className="truncate font-medium">{server.name}</div>
                    <Badge variant={getStatusBadgeVariant(server.status)}>{server.status}</Badge>
                  </div>
                  <div className="mt-1 truncate text-muted-foreground">{server.command}</div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-sm border border-border p-3">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <ShieldCheck className="size-3.5" />
              Connector Surface
            </div>
            <div className="mt-2 text-xs text-muted-foreground">
              {connectors.length} configured connector(s)
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {installedConnectorKeys.length === 0 && (
                <Badge variant="outline">No connectors configured</Badge>
              )}
              {installedConnectorKeys.map((key) => (
                <Badge key={key} variant="outline">
                  {key}
                </Badge>
              ))}
            </div>
          </div>
        </div>

        <div className="mt-3 rounded-sm border border-border p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2 text-[11px] uppercase tracking-wider text-muted-foreground">
              <Wrench className="size-3.5" />
              Tool Registry
            </div>
            <div className="flex items-center gap-2">
              <select
                value={toolFilter}
                onChange={(event) =>
                  setToolFilter(event.target.value as "all" | "system" | "custom")
                }
                className="h-8 rounded-sm border border-input bg-background px-2 text-xs"
              >
                <option value="all">All tools</option>
                <option value="system">System only</option>
                <option value="custom">Custom only</option>
              </select>
              <Button size="sm" variant="outline" className="h-8 text-xs" onClick={startCreateTool}>
                <Plus className="mr-1 size-3.5" />
                New Custom Tool
              </Button>
            </div>
          </div>

          <div className="mt-2 grid gap-2 md:grid-cols-2 xl:grid-cols-3">
            {filteredTools.map((entry) => (
              <button
                key={entry.id}
                onClick={() => selectTool(entry.id)}
                className={`rounded-sm border p-2 text-left text-xs transition-colors ${
                  selectedToolId === entry.id && !isCreatingTool
                    ? "border-primary bg-primary/10"
                    : "border-border hover:bg-background-interactive"
                }`}
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="truncate font-medium">{entry.name}</div>
                  <Badge variant={getRiskBadgeVariant(entry.riskTier)}>Tier {entry.riskTier}</Badge>
                </div>
                <div className="mt-1 truncate text-muted-foreground">{entry.displayName}</div>
                <div className="mt-1 line-clamp-2 text-muted-foreground">{entry.description}</div>
                <div className="mt-2 flex flex-wrap gap-1">
                  <Badge variant={entry.source === "system" ? "outline" : "info"}>
                    {entry.source}
                  </Badge>
                  <Badge variant={entry.enabled ? "info" : "outline"}>
                    {entry.enabled ? "enabled" : "disabled"}
                  </Badge>
                  <Badge variant="outline">{entry.category}</Badge>
                  <Badge variant="outline">{entry.action}</Badge>
                </div>
              </button>
            ))}
            {filteredTools.length === 0 && (
              <div className="rounded-sm border border-border p-2 text-xs text-muted-foreground">
                No tools match this filter.
              </div>
            )}
          </div>
        </div>

        <div className="mt-3 rounded-sm border border-border p-3">
          <div className="text-[11px] uppercase tracking-wider text-muted-foreground">
            {isCreatingTool ? "Create Custom Tool" : "Tool Detail / Editor"}
          </div>
          <div className="mt-2 grid gap-2 md:grid-cols-2">
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Name
              </label>
              <Input
                value={toolForm.name}
                onChange={(event) =>
                  setToolForm((current) => ({
                    ...current,
                    name: normalizeToolName(event.target.value)
                  }))
                }
                placeholder="my_custom_tool"
                disabled={editorIsSystemTool}
                className="mt-1 h-8 text-xs"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Display Name
              </label>
              <Input
                value={toolForm.displayName}
                onChange={(event) =>
                  setToolForm((current) => ({ ...current, displayName: event.target.value }))
                }
                placeholder="My Custom Tool"
                disabled={editorIsSystemTool}
                className="mt-1 h-8 text-xs"
              />
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Description
              </label>
              <textarea
                value={toolForm.description}
                onChange={(event) =>
                  setToolForm((current) => ({ ...current, description: event.target.value }))
                }
                disabled={editorIsSystemTool}
                className="mt-1 h-20 w-full rounded-sm border border-input bg-background px-2 py-1 text-xs"
              />
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Category
              </label>
              <select
                value={toolForm.category}
                onChange={(event) =>
                  setToolForm((current) => ({
                    ...current,
                    category: event.target.value as ToolDefinition["category"]
                  }))
                }
                disabled={editorIsSystemTool}
                className="mt-1 h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
              >
                {TOOL_CATEGORY_OPTIONS.map((category) => (
                  <option key={category} value={category}>
                    {category}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Action
              </label>
              <select
                value={toolForm.action}
                onChange={(event) =>
                  setToolForm((current) => ({
                    ...current,
                    action: event.target.value as ToolDefinition["action"]
                  }))
                }
                disabled={editorIsSystemTool}
                className="mt-1 h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
              >
                {TOOL_ACTION_OPTIONS.map((action) => (
                  <option key={action} value={action}>
                    {action}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Risk Tier
              </label>
              <select
                value={toolForm.riskTier}
                onChange={(event) =>
                  setToolForm((current) => ({
                    ...current,
                    riskTier: Number(event.target.value) as ToolDefinition["riskTier"]
                  }))
                }
                disabled={editorIsSystemTool}
                className="mt-1 h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
              >
                <option value={0}>Tier 0</option>
                <option value={1}>Tier 1</option>
                <option value={2}>Tier 2</option>
                <option value={3}>Tier 3</option>
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Implementation
              </label>
              <select
                value={toolForm.implementationType}
                onChange={(event) =>
                  setToolForm((current) => ({
                    ...current,
                    implementationType: event.target.value as ToolDefinition["implementationType"]
                  }))
                }
                disabled={editorIsSystemTool}
                className="mt-1 h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
              >
                {TOOL_IMPLEMENTATION_OPTIONS.map((implementationType) => (
                  <option key={implementationType} value={implementationType}>
                    {implementationType}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Enabled
              </label>
              <label className="mt-1 flex h-8 items-center gap-2 rounded-sm border border-input bg-background px-2 text-xs">
                <input
                  type="checkbox"
                  checked={toolForm.enabled}
                  onChange={(event) =>
                    setToolForm((current) => ({
                      ...current,
                      enabled: event.target.checked
                    }))
                  }
                  className="size-3.5"
                />
                Enabled in runtime
              </label>
            </div>
            <div className="md:col-span-2">
              <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
                Config JSON
              </label>
              <textarea
                value={toolForm.configJson}
                onChange={(event) =>
                  setToolForm((current) => ({ ...current, configJson: event.target.value }))
                }
                disabled={editorIsSystemTool}
                className="mt-1 h-40 w-full rounded-sm border border-input bg-background px-2 py-1 font-mono text-[11px]"
                placeholder='{"commandTemplate":"npm test -- {{target}}"}'
              />
              <div className="mt-1 text-[11px] text-muted-foreground">
                Script tools require <code>commandTemplate</code>. Use <code>{"{{token}}"}</code>{" "}
                for shell-safe substitution and <code>{"{{{token}}}"}</code> for raw insertion.
              </div>
            </div>
          </div>

          {!isCreatingTool && selectedTool && (
            <div className="mt-2 grid gap-2 text-[11px] text-muted-foreground md:grid-cols-2">
              <div className="truncate">ID: {selectedTool.id}</div>
              <div>Source: {selectedTool.source}</div>
              <div>Created: {formatDate(selectedTool.createdAt)}</div>
              <div>Updated: {formatDate(selectedTool.updatedAt)}</div>
            </div>
          )}

          {toolStatus && <div className="mt-2 text-xs text-status-warning">{toolStatus}</div>}

          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              className="h-8 text-xs"
              onClick={() => void saveTool()}
              disabled={isToolSaving}
            >
              <Save className="mr-1 size-3.5" />
              {isToolSaving ? "Saving..." : "Save Tool"}
            </Button>
            {showDelete && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => void deleteSelectedTool()}
                disabled={isToolDeleting}
              >
                <Trash2 className="mr-1 size-3.5" />
                {isToolDeleting ? "Deleting..." : "Delete Tool"}
              </Button>
            )}
            {isCreatingTool && (
              <Button
                size="sm"
                variant="outline"
                className="h-8 text-xs"
                onClick={() => {
                  setIsCreatingTool(false)
                  setToolStatus(null)
                  if (tools.length > 0) {
                    setSelectedToolId(tools[0].id)
                  }
                }}
              >
                Cancel
              </Button>
            )}
          </div>
        </div>
      </div>

      <aside className="w-[360px] shrink-0 overflow-auto border-l border-border bg-sidebar p-4">
        <div className="text-section-header">SKILL DETAIL</div>
        <div className="mt-1 text-xs text-muted-foreground">
          Review full skill instructions from global skill registries.
        </div>

        {!selectedSkillId && (
          <div className="mt-3 rounded-sm border border-border bg-background px-2 py-1.5 text-xs text-muted-foreground">
            Select a skill to inspect.
          </div>
        )}

        {selectedSkillDetail && (
          <div className="mt-3 rounded-sm border border-border bg-background p-2">
            <div className="text-sm font-medium">{selectedSkillDetail.skill.name}</div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              {selectedSkillDetail.skill.description}
            </div>
            <div className="mt-1 text-[11px] text-muted-foreground">
              Source: {selectedSkillDetail.skill.source}
            </div>
            <div className="mt-1 break-all text-[10px] text-muted-foreground">
              {selectedSkillDetail.skill.path}
            </div>
            {selectedSkillDetail.skill.allowedTools.length > 0 && (
              <div className="mt-2 flex flex-wrap gap-1">
                {selectedSkillDetail.skill.allowedTools.map((toolName) => (
                  <Badge key={`${selectedSkillDetail.skill.id}:${toolName}`} variant="outline">
                    {toolName}
                  </Badge>
                ))}
              </div>
            )}
            <pre className="mt-2 max-h-56 overflow-auto whitespace-pre-wrap rounded-sm border border-border bg-sidebar p-2 font-mono text-[10px] text-muted-foreground">
              {selectedSkillDetail.content}
            </pre>
          </div>
        )}

        {isSkillDetailLoading && (
          <div className="mt-2 text-xs text-muted-foreground">Loading skill detail...</div>
        )}
        {skillDetailStatus && (
          <div className="mt-2 text-xs text-status-warning">{skillDetailStatus}</div>
        )}

        <div className="mt-4 border-t border-border pt-4">
          <div className="text-section-header">TOOL TEST CONSOLE</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Safe preview sandbox. This does not execute tools.
          </div>

          <div className="mt-3">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Tool
            </label>
            <select
              value={selectedToolNameForTest}
              onChange={(event) => setSelectedToolNameForTest(event.target.value)}
              className="mt-1 h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
            >
              {tools.map((entry) => (
                <option key={entry.id} value={entry.name}>
                  {entry.name}
                </option>
              ))}
            </select>
          </div>

          <div className="mt-3">
            <label className="text-[11px] uppercase tracking-wider text-muted-foreground">
              Args JSON
            </label>
            <textarea
              value={testArgsJson}
              onChange={(event) => setTestArgsJson(event.target.value)}
              className="mt-1 h-40 w-full rounded-sm border border-input bg-background px-2 py-1 font-mono text-[11px]"
              placeholder='{"path":"README.md"}'
            />
          </div>

          <Button size="sm" className="mt-3 h-8 w-full text-xs" onClick={runToolTestDryRun}>
            <FlaskConical className="mr-1 size-3.5" />
            Run Safe Preview
          </Button>

          {testConsoleOutput && (
            <pre className="mt-3 whitespace-pre-wrap rounded-sm border border-border bg-background p-2 font-mono text-[11px] text-muted-foreground">
              {testConsoleOutput}
            </pre>
          )}
        </div>
      </aside>
    </section>
  )
}
