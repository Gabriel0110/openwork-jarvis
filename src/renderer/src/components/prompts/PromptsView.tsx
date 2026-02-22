import { useCallback, useEffect, useMemo, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { Download, FileText, Filter, RefreshCw, Save, Upload, Wand2 } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { useAppStore } from "@/lib/store"
import type {
  AgentDefinition,
  PromptAsset,
  PromptBinding,
  PromptMaterializationRecord
} from "@/types"

interface PromptFormState {
  title: string
  description: string
  slug: string
  fileName: string
  scope: "global" | "workspace"
  tags: string
  variables: string
  content: string
}

function emptyPromptForm(): PromptFormState {
  return {
    title: "",
    description: "",
    slug: "",
    fileName: "AGENTS.md",
    scope: "workspace",
    tags: "",
    variables: "",
    content: ""
  }
}

function arrayToCsv(values: string[]): string {
  return values.join(", ")
}

function csvToArray(values: string): string[] {
  return values
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function formatDate(value?: Date | string): string {
  if (!value) return "Never"
  const date = value instanceof Date ? value : new Date(value)
  return Number.isFinite(date.getTime()) ? date.toLocaleString() : "Unknown"
}

function badgeVariantForSource(source: PromptAsset["source"]): "outline" | "info" | "warning" {
  if (source === "managed") return "info"
  if (source === "discovered_agents") return "warning"
  return "outline"
}

function badgeVariantForBindingStatus(
  status: PromptBinding["status"]
): "outline" | "nominal" | "warning" | "critical" {
  if (status === "in_sync") return "nominal"
  if (status === "failed") return "critical"
  if (status === "conflict") return "warning"
  return "outline"
}

export function PromptsView(): React.JSX.Element {
  const { agents, promptsAgentsOnly, setPromptsAgentsOnly } = useAppStore()
  const [workspaceId, setWorkspaceId] = useState<string>(
    agents[0]?.workspaceId || "default-workspace"
  )
  const [workspaceRoot, setWorkspaceRoot] = useState<string>("")
  const [assets, setAssets] = useState<PromptAsset[]>([])
  const [effectiveAssets, setEffectiveAssets] = useState<PromptAsset[]>([])
  const [bindings, setBindings] = useState<PromptBinding[]>([])
  const [history, setHistory] = useState<PromptMaterializationRecord[]>([])
  const [selectedAssetId, setSelectedAssetId] = useState<string | null>(null)
  const [selectedAssetContent, setSelectedAssetContent] = useState<string>("")
  const [search, setSearch] = useState("")
  const [status, setStatus] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [isSaving, setIsSaving] = useState(false)
  const [form, setForm] = useState<PromptFormState>(emptyPromptForm)
  const [isCreateMode, setIsCreateMode] = useState(false)
  const [bindingTargetType, setBindingTargetType] = useState<"workspace" | "agent">("workspace")
  const [bindingTargetAgentId, setBindingTargetAgentId] = useState<string>("")
  const [bindingMode, setBindingMode] = useState<"workspace_root" | "agent_docs">("workspace_root")
  const [bindingRelativePath, setBindingRelativePath] = useState<string>("")
  const [conflictPreview, setConflictPreview] = useState<{
    bindingId: string
    resolvedPath: string
    currentContent?: string
    assetContent?: string
  } | null>(null)
  const [importContent, setImportContent] = useState<string>("")
  const workspaceAgents = useMemo(
    () => agents.filter((agent) => agent.workspaceId === workspaceId),
    [agents, workspaceId]
  )

  const selectedAsset = useMemo(
    () => assets.find((asset) => asset.id === selectedAssetId) || null,
    [assets, selectedAssetId]
  )

  const selectedAssetBindings = useMemo(
    () => bindings.filter((binding) => binding.assetId === selectedAssetId),
    [bindings, selectedAssetId]
  )

  const applyAssetToForm = useCallback((asset: PromptAsset, content: string): void => {
    setForm({
      title: asset.title,
      description: asset.description || "",
      slug: asset.slug,
      fileName: asset.fileName,
      scope: asset.scope,
      tags: arrayToCsv(asset.tags),
      variables: arrayToCsv(asset.variables),
      content
    })
  }, [])

  const loadAll = useCallback(async (): Promise<void> => {
    setIsLoading(true)
    try {
      const [library, loadedBindings, loadedHistory] = await Promise.all([
        window.api.prompts.list({
          workspaceId,
          query: search.trim() || undefined,
          agentsOnly: promptsAgentsOnly
        }),
        window.api.prompts.bindings.list(workspaceId),
        window.api.prompts.history.list({ workspaceId, limit: 100 })
      ])

      setAssets(library.assets)
      setEffectiveAssets(library.effectiveAssets)
      setBindings(loadedBindings)
      setHistory(loadedHistory)
      setStatus(null)

      if (!selectedAssetId && library.effectiveAssets.length > 0) {
        setSelectedAssetId(library.effectiveAssets[0].id)
      } else if (
        selectedAssetId &&
        !library.assets.some((asset) => asset.id === selectedAssetId) &&
        library.effectiveAssets.length > 0
      ) {
        setSelectedAssetId(library.effectiveAssets[0].id)
      }
    } catch (error) {
      setStatus(
        `Failed to load prompts: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    } finally {
      setIsLoading(false)
    }
  }, [promptsAgentsOnly, search, selectedAssetId, workspaceId])

  useEffect(() => {
    const nextWorkspaceId = agents[0]?.workspaceId || "default-workspace"
    if (workspaceId !== nextWorkspaceId) {
      setWorkspaceId(nextWorkspaceId)
    }
  }, [agents, workspaceId])

  useEffect(() => {
    void loadAll()
  }, [loadAll])

  useEffect(() => {
    void window.api.workspace
      .get()
      .then((path) => setWorkspaceRoot(path || ""))
      .catch(() => setWorkspaceRoot(""))
  }, [workspaceId])

  useEffect(() => {
    if (!selectedAssetId) {
      setSelectedAssetContent("")
      return
    }

    let cancelled = false
    void window.api.prompts
      .get(selectedAssetId)
      .then((detail) => {
        if (cancelled) return
        setSelectedAssetContent(detail.content)
        if (!isCreateMode) {
          applyAssetToForm(detail.asset, detail.content)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setSelectedAssetContent("")
          setStatus(
            `Failed to load prompt content: ${error instanceof Error ? error.message : "Unknown error"}`
          )
        }
      })
    return () => {
      cancelled = true
    }
  }, [applyAssetToForm, isCreateMode, selectedAssetId])

  async function refreshDiscovery(): Promise<void> {
    try {
      await window.api.prompts.refreshDiscovery()
      await loadAll()
      setStatus("Prompt discovery refreshed.")
    } catch (error) {
      setStatus(`Refresh failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  function startCreate(): void {
    setIsCreateMode(true)
    setSelectedAssetId(null)
    setSelectedAssetContent("")
    setForm(emptyPromptForm())
    setStatus("Creating a managed prompt asset.")
  }

  function cancelCreate(): void {
    setIsCreateMode(false)
    if (effectiveAssets.length > 0) {
      setSelectedAssetId(effectiveAssets[0].id)
    }
  }

  async function savePrompt(): Promise<void> {
    setIsSaving(true)
    setStatus(null)
    try {
      if (isCreateMode) {
        const created = await window.api.prompts.create({
          workspaceId,
          title: form.title,
          description: form.description || undefined,
          slug: form.slug || undefined,
          fileName: form.fileName,
          scope: form.scope,
          tags: csvToArray(form.tags),
          variables: csvToArray(form.variables),
          content: form.content
        })
        setSelectedAssetId(created.id)
        setIsCreateMode(false)
        setStatus(`Created prompt "${created.title}".`)
      } else if (selectedAsset) {
        if (selectedAsset.source !== "managed") {
          setStatus("Discovered prompts are read-only. Create a managed copy to edit.")
          return
        }
        const updated = await window.api.prompts.update(selectedAsset.id, {
          title: form.title,
          description: form.description || undefined,
          slug: form.slug || undefined,
          fileName: form.fileName,
          tags: csvToArray(form.tags),
          variables: csvToArray(form.variables),
          content: form.content
        })
        setSelectedAssetId(updated.id)
        setStatus(`Saved prompt "${updated.title}".`)
      }
      await loadAll()
    } catch (error) {
      setStatus(`Save failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    } finally {
      setIsSaving(false)
    }
  }

  async function deletePrompt(): Promise<void> {
    if (!selectedAsset || selectedAsset.source !== "managed") {
      return
    }
    const confirmed = window.confirm(`Delete prompt "${selectedAsset.title}"?`)
    if (!confirmed) return
    try {
      await window.api.prompts.delete(selectedAsset.id)
      setSelectedAssetId(null)
      setSelectedAssetContent("")
      await loadAll()
      setStatus("Prompt deleted.")
    } catch (error) {
      setStatus(`Delete failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  async function createBinding(): Promise<void> {
    if (!selectedAsset) {
      setStatus("Select a prompt asset first.")
      return
    }
    try {
      await window.api.prompts.bindings.create({
        assetId: selectedAsset.id,
        workspaceId,
        targetType: bindingTargetType,
        targetAgentId:
          bindingTargetType === "agent" ? bindingTargetAgentId || undefined : undefined,
        materializeMode: bindingMode,
        relativeOutputPath: bindingRelativePath.trim() || undefined,
        enabled: true
      })
      await loadAll()
      setStatus("Binding created.")
    } catch (error) {
      setStatus(
        `Create binding failed: ${error instanceof Error ? error.message : "Unknown error"}`
      )
    }
  }

  async function applyBinding(bindingId: string): Promise<void> {
    try {
      const result = await window.api.prompts.materialize({
        bindingId,
        workspaceRoot: workspaceRoot || undefined
      })
      if (result.status === "conflict" && result.conflict) {
        setConflictPreview({
          bindingId: result.conflict.bindingId,
          resolvedPath: result.conflict.resolvedPath,
          currentContent: result.conflict.currentContent,
          assetContent: result.conflict.assetContent
        })
      } else {
        setConflictPreview(null)
      }
      setStatus(
        `Materialization ${result.status}: ${result.record.message || result.record.resolvedPath}`
      )
      await loadAll()
    } catch (error) {
      setStatus(`Apply failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  async function overwriteConflict(bindingId: string): Promise<void> {
    try {
      const result = await window.api.prompts.materialize({
        bindingId,
        workspaceRoot: workspaceRoot || undefined,
        overwriteConflict: true
      })
      setStatus(
        `Overwrite ${result.status}: ${result.record.message || result.record.resolvedPath}`
      )
      setConflictPreview(null)
      await loadAll()
    } catch (error) {
      setStatus(`Overwrite failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  async function applyAllBindings(): Promise<void> {
    try {
      const results = await window.api.prompts.materializeAll({
        workspaceId,
        workspaceRoot: workspaceRoot || undefined
      })
      const summary = results.reduce(
        (acc, result) => {
          acc[result.status] += 1
          return acc
        },
        { applied: 0, conflict: 0, failed: 0, skipped: 0 }
      )
      setStatus(
        `Applied all bindings. Applied ${summary.applied}, conflicts ${summary.conflict}, failed ${summary.failed}, skipped ${summary.skipped}.`
      )
      await loadAll()
    } catch (error) {
      setStatus(`Apply all failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  async function exportPack(format: "json" | "yaml"): Promise<void> {
    try {
      const result = await window.api.prompts.exportPack({
        workspaceId,
        includeBindings: true,
        format
      })
      await navigator.clipboard.writeText(result.content)
      setStatus(`Exported ${result.pack.assets.length} prompts (${format}) to clipboard.`)
    } catch (error) {
      setStatus(`Export failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  async function importPack(): Promise<void> {
    if (!importContent.trim()) {
      setStatus("Paste JSON or YAML prompt pack content before importing.")
      return
    }
    try {
      const result = await window.api.prompts.importPack({
        content: importContent,
        workspaceId
      })
      await loadAll()
      setStatus(
        `Imported ${result.importedAssets.length} prompt assets and ${result.importedBindings.length} bindings.`
      )
      setImportContent("")
    } catch (error) {
      setStatus(`Import failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  return (
    <section className="flex h-full min-h-0 flex-col overflow-hidden bg-background">
      <div className="flex items-center gap-2 border-b border-border px-6 py-4">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void refreshDiscovery()}
          disabled={isLoading}
        >
          <RefreshCw className="mr-2 size-4" />
          Refresh Discovery
        </Button>
        <Button variant="outline" size="sm" onClick={startCreate}>
          <FileText className="mr-2 size-4" />
          New Prompt
        </Button>
        <Button variant="outline" size="sm" onClick={() => void applyAllBindings()}>
          <Wand2 className="mr-2 size-4" />
          Apply All Bindings
        </Button>
        <Button variant="outline" size="sm" onClick={() => void exportPack("json")}>
          <Download className="mr-2 size-4" />
          Export JSON
        </Button>
        <Button variant="outline" size="sm" onClick={() => void exportPack("yaml")}>
          <Download className="mr-2 size-4" />
          Export YAML
        </Button>
        <div className="ml-auto flex items-center gap-2">
          <Button
            variant={promptsAgentsOnly ? "default" : "outline"}
            size="sm"
            onClick={() => setPromptsAgentsOnly(!promptsAgentsOnly)}
          >
            <Filter className="mr-2 size-4" />
            AGENTS only
          </Button>
          <Input
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search prompts..."
            className="h-8 w-56"
          />
        </div>
      </div>

      <div className="grid flex-1 min-h-0 grid-cols-[320px_1fr_420px] overflow-hidden">
        <div className="border-r border-border p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">
            Library ({effectiveAssets.length})
          </div>
          <div className="mt-3 space-y-2 overflow-y-auto pr-1">
            {effectiveAssets.map((asset) => (
              <button
                key={asset.id}
                onClick={() => {
                  setIsCreateMode(false)
                  setSelectedAssetId(asset.id)
                }}
                className={`w-full rounded-md border px-3 py-2 text-left transition-colors ${
                  selectedAssetId === asset.id
                    ? "border-primary bg-sidebar-accent"
                    : "border-border hover:bg-background-interactive"
                }`}
              >
                <div className="truncate text-sm font-medium">{asset.title}</div>
                <div className="mt-1 flex flex-wrap items-center gap-1">
                  <Badge variant={badgeVariantForSource(asset.source)}>{asset.source}</Badge>
                  <Badge variant="outline">{asset.scope}</Badge>
                  {asset.fileName.toUpperCase() === "AGENTS.MD" && (
                    <Badge variant="warning">AGENTS</Badge>
                  )}
                </div>
                <div className="mt-1 truncate text-xs text-muted-foreground">{asset.slug}</div>
              </button>
            ))}
            {effectiveAssets.length === 0 && (
              <div className="rounded-md border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
                No prompts found.
              </div>
            )}
          </div>
        </div>

        <div className="min-h-0 overflow-y-auto border-r border-border p-4">
          <div className="flex items-center justify-between">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              {isCreateMode ? "Create Prompt" : "Prompt Detail"}
            </div>
            {!isCreateMode && selectedAsset && selectedAsset.source === "managed" && (
              <Button variant="outline" size="sm" onClick={() => void deletePrompt()}>
                Delete
              </Button>
            )}
          </div>

          {(isCreateMode || selectedAsset) && (
            <div className="mt-3 space-y-3">
              <Input
                value={form.title}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                placeholder="Title"
              />
              <Input
                value={form.description}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, description: event.target.value }))
                }
                placeholder="Description (optional)"
              />
              <div className="grid grid-cols-2 gap-2">
                <Input
                  value={form.slug}
                  onChange={(event) => setForm((prev) => ({ ...prev, slug: event.target.value }))}
                  placeholder="slug/path"
                />
                <Input
                  value={form.fileName}
                  onChange={(event) =>
                    setForm((prev) => ({ ...prev, fileName: event.target.value }))
                  }
                  placeholder="AGENTS.md"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <select
                  className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                  value={form.scope}
                  onChange={(event) =>
                    setForm((prev) => ({
                      ...prev,
                      scope: event.target.value as "global" | "workspace"
                    }))
                  }
                >
                  <option value="workspace">workspace</option>
                  <option value="global">global</option>
                </select>
                <Input
                  value={workspaceRoot}
                  onChange={(event) => setWorkspaceRoot(event.target.value)}
                  placeholder="Workspace root path"
                />
              </div>
              <Input
                value={form.tags}
                onChange={(event) => setForm((prev) => ({ ...prev, tags: event.target.value }))}
                placeholder="Tags (comma-separated)"
              />
              <Input
                value={form.variables}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, variables: event.target.value }))
                }
                placeholder="Variables (comma-separated)"
              />
              <textarea
                value={form.content}
                onChange={(event) => setForm((prev) => ({ ...prev, content: event.target.value }))}
                className="h-72 w-full rounded-md border border-input bg-background p-3 font-mono text-xs"
                placeholder="Markdown content..."
                readOnly={!isCreateMode && selectedAsset?.source !== "managed"}
              />
              <div className="flex items-center gap-2">
                {(isCreateMode || selectedAsset?.source === "managed") && (
                  <Button size="sm" onClick={() => void savePrompt()} disabled={isSaving}>
                    <Save className="mr-2 size-4" />
                    {isSaving ? "Saving..." : "Save Prompt"}
                  </Button>
                )}
                {isCreateMode && (
                  <Button variant="outline" size="sm" onClick={cancelCreate}>
                    Cancel
                  </Button>
                )}
              </div>
              <div className="rounded-md border border-border p-3">
                <div className="mb-2 text-xs uppercase tracking-wider text-muted-foreground">
                  Rendered Preview
                </div>
                <div className="prose prose-invert max-w-none text-sm">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {isCreateMode ? form.content : selectedAssetContent}
                  </ReactMarkdown>
                </div>
              </div>
            </div>
          )}

          {!isCreateMode && !selectedAsset && (
            <div className="mt-4 rounded-md border border-dashed border-border px-3 py-6 text-sm text-muted-foreground">
              Select a prompt to inspect and bind.
            </div>
          )}
        </div>

        <div className="min-h-0 overflow-y-auto p-4">
          <div className="text-xs uppercase tracking-wider text-muted-foreground">Bindings</div>
          {selectedAsset ? (
            <div className="mt-3 space-y-3">
              <div className="rounded-md border border-border p-3">
                <div className="grid grid-cols-2 gap-2">
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={bindingTargetType}
                    onChange={(event) =>
                      setBindingTargetType(event.target.value as "workspace" | "agent")
                    }
                  >
                    <option value="workspace">workspace</option>
                    <option value="agent">agent</option>
                  </select>
                  <select
                    className="h-9 rounded-md border border-input bg-background px-2 text-sm"
                    value={bindingMode}
                    onChange={(event) =>
                      setBindingMode(event.target.value as "workspace_root" | "agent_docs")
                    }
                  >
                    <option value="workspace_root">workspace_root</option>
                    <option value="agent_docs">agent_docs</option>
                  </select>
                </div>
                {bindingTargetType === "agent" && (
                  <select
                    className="mt-2 h-9 w-full rounded-md border border-input bg-background px-2 text-sm"
                    value={bindingTargetAgentId}
                    onChange={(event) => setBindingTargetAgentId(event.target.value)}
                  >
                    <option value="">Select agent</option>
                    {workspaceAgents.map((agent: AgentDefinition) => (
                      <option key={agent.id} value={agent.id}>
                        {agent.name}
                      </option>
                    ))}
                  </select>
                )}
                <Input
                  className="mt-2"
                  value={bindingRelativePath}
                  onChange={(event) => setBindingRelativePath(event.target.value)}
                  placeholder="Optional output path (e.g. AGENTS.md)"
                />
                <Button className="mt-2 w-full" size="sm" onClick={() => void createBinding()}>
                  Create Binding
                </Button>
              </div>

              <div className="space-y-2">
                {conflictPreview && (
                  <div className="rounded-md border border-status-warning/60 bg-status-warning/10 p-3">
                    <div className="text-sm font-medium text-status-warning">Conflict preview</div>
                    <div className="mt-1 truncate text-xs text-muted-foreground">
                      {conflictPreview.resolvedPath}
                    </div>
                    <div className="mt-2 grid gap-2 md:grid-cols-2">
                      <div>
                        <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                          Current file
                        </div>
                        <pre className="max-h-44 overflow-auto rounded-md border border-border bg-background p-2 text-[11px]">
                          {conflictPreview.currentContent || "(empty)"}
                        </pre>
                      </div>
                      <div>
                        <div className="mb-1 text-[11px] uppercase tracking-wider text-muted-foreground">
                          Managed render
                        </div>
                        <pre className="max-h-44 overflow-auto rounded-md border border-border bg-background p-2 text-[11px]">
                          {conflictPreview.assetContent || "(empty)"}
                        </pre>
                      </div>
                    </div>
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void overwriteConflict(conflictPreview.bindingId)}
                      >
                        Overwrite With Managed
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => setConflictPreview(null)}>
                        Dismiss
                      </Button>
                    </div>
                  </div>
                )}
                {selectedAssetBindings.map((binding) => (
                  <div key={binding.id} className="rounded-md border border-border p-3">
                    <div className="flex items-center justify-between">
                      <div className="text-sm font-medium">
                        {binding.targetType === "workspace" ? "Workspace" : "Agent"}
                      </div>
                      <Badge variant={badgeVariantForBindingStatus(binding.status)}>
                        {binding.status}
                      </Badge>
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      mode: {binding.materializeMode}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      path: {binding.relativeOutputPath || selectedAsset.fileName}
                    </div>
                    <div className="mt-1 text-xs text-muted-foreground">
                      updated: {formatDate(binding.updatedAt)}
                    </div>
                    {binding.lastError && (
                      <div className="mt-2 rounded-md border border-status-critical/40 bg-status-critical/10 px-2 py-1 text-xs text-status-critical">
                        {binding.lastError}
                      </div>
                    )}
                    <div className="mt-2 flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => void applyBinding(binding.id)}
                      >
                        Apply
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={async () => {
                          await window.api.prompts.bindings.delete(binding.id)
                          await loadAll()
                        }}
                      >
                        Remove
                      </Button>
                    </div>
                  </div>
                ))}
                {selectedAssetBindings.length === 0 && (
                  <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                    No bindings yet.
                  </div>
                )}
              </div>
            </div>
          ) : (
            <div className="mt-3 rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
              Select a prompt to manage bindings.
            </div>
          )}

          <div className="mt-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">
              Import Pack
            </div>
            <textarea
              value={importContent}
              onChange={(event) => setImportContent(event.target.value)}
              className="mt-2 h-24 w-full rounded-md border border-input bg-background p-2 font-mono text-xs"
              placeholder="Paste JSON or YAML prompt pack here..."
            />
            <Button className="mt-2 w-full" size="sm" onClick={() => void importPack()}>
              <Upload className="mr-2 size-4" />
              Import Prompt Pack
            </Button>
          </div>

          <div className="mt-5">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">History</div>
            <div className="mt-2 space-y-2">
              {history.slice(0, 8).map((entry) => (
                <div key={entry.id} className="rounded-md border border-border px-3 py-2 text-xs">
                  <div className="font-medium">{entry.status}</div>
                  <div className="truncate text-muted-foreground">{entry.resolvedPath}</div>
                  <div className="text-muted-foreground">{formatDate(entry.createdAt)}</div>
                </div>
              ))}
              {history.length === 0 && (
                <div className="rounded-md border border-dashed border-border px-3 py-4 text-sm text-muted-foreground">
                  No materialization history yet.
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {status && (
        <div className="border-t border-border px-6 py-2 text-xs text-muted-foreground">
          {status}
        </div>
      )}
    </section>
  )
}
