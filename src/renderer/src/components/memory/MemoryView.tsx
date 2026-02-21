import { useCallback, useEffect, useMemo, useState } from "react"
import {
  BookText,
  Database,
  Lock,
  LockOpen,
  RefreshCcw,
  RotateCcw,
  Search,
  Trash2
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/lib/store"
import type { MemoryEntry, MemoryEntryScope, MemorySearchResult, RagSource } from "@/types"

type ScopeFilter = MemoryEntryScope | "all"

const DEFAULT_WORKSPACE_ID = "default-workspace"

function toScopeLabel(scope: MemoryEntryScope): string {
  if (scope === "session") return "Session"
  if (scope === "agent") return "Agent"
  return "Workspace"
}

function formatTimestamp(value: Date): string {
  return new Date(value).toLocaleString()
}

export function MemoryView(): React.JSX.Element {
  const { agents, currentThreadId, loadAgents } = useAppStore()
  const [entries, setEntries] = useState<MemoryEntry[]>([])
  const [sources, setSources] = useState<RagSource[]>([])
  const [results, setResults] = useState<MemorySearchResult[]>([])

  const [scopeFilter, setScopeFilter] = useState<ScopeFilter>("all")
  const [entryScope, setEntryScope] = useState<MemoryEntryScope>("workspace")
  const [entryAgentId, setEntryAgentId] = useState("")
  const [entryTitle, setEntryTitle] = useState("")
  const [entryContent, setEntryContent] = useState("")
  const [entryTags, setEntryTags] = useState("")
  const [sourcePath, setSourcePath] = useState("/docs")
  const [query, setQuery] = useState("")
  const [busyMessage, setBusyMessage] = useState<string | null>(null)

  const workspaceId = useMemo(() => agents[0]?.workspaceId || DEFAULT_WORKSPACE_ID, [agents])
  const agentNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const agent of agents) {
      map.set(agent.id, agent.name)
    }
    return map
  }, [agents])

  const loadEntries = useCallback(async () => {
    const loaded = await window.api.memory.listEntries({
      workspaceId,
      scope: scopeFilter === "all" ? undefined : scopeFilter,
      limit: 300
    })
    setEntries(loaded)
  }, [scopeFilter, workspaceId])

  const loadSources = useCallback(async () => {
    const loaded = await window.api.memory.listSources(workspaceId)
    setSources(loaded)
  }, [workspaceId])

  const refreshAll = useCallback(async () => {
    setBusyMessage("Refreshing memory data...")
    try {
      await Promise.all([loadEntries(), loadSources()])
    } finally {
      setBusyMessage(null)
    }
  }, [loadEntries, loadSources])

  useEffect(() => {
    void loadAgents()
  }, [loadAgents])

  useEffect(() => {
    void refreshAll()
  }, [refreshAll])

  const createEntry = async (): Promise<void> => {
    const content = entryContent.trim()
    if (!content) {
      return
    }

    setBusyMessage("Saving memory entry...")
    try {
      await window.api.memory.createEntry({
        workspaceId,
        scope: entryScope,
        agentId: entryScope === "agent" ? entryAgentId || undefined : undefined,
        threadId: entryScope === "session" ? currentThreadId || undefined : undefined,
        title: entryTitle.trim() || undefined,
        content,
        tags: entryTags
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean),
        source: "manual"
      })
      setEntryTitle("")
      setEntryContent("")
      setEntryTags("")
      await loadEntries()
    } finally {
      setBusyMessage(null)
    }
  }

  const removeEntry = async (entryId: string): Promise<void> => {
    setBusyMessage("Deleting memory entry...")
    try {
      await window.api.memory.deleteEntry(entryId)
      await loadEntries()
    } finally {
      setBusyMessage(null)
    }
  }

  const toggleEntryLock = async (entry: MemoryEntry): Promise<void> => {
    setBusyMessage(`${entry.locked ? "Unlocking" : "Locking"} memory entry...`)
    try {
      await window.api.memory.setEntryLocked(entry.id, !entry.locked)
      await loadEntries()
    } finally {
      setBusyMessage(null)
    }
  }

  const restoreEntryAsNew = async (entry: MemoryEntry): Promise<void> => {
    setBusyMessage("Restoring memory snapshot as new entry...")
    try {
      await window.api.memory.createEntry({
        workspaceId,
        scope: entry.scope,
        agentId: entry.agentId,
        threadId: entry.threadId,
        title: entry.title ? `${entry.title} (restored)` : "Restored memory",
        content: entry.content,
        tags: entry.tags,
        source: `restore:${entry.id}`
      })
      await loadEntries()
    } finally {
      setBusyMessage(null)
    }
  }

  const addSource = async (): Promise<void> => {
    const pathValue = sourcePath.trim()
    if (!pathValue) {
      return
    }
    setBusyMessage("Adding RAG source...")
    try {
      await window.api.memory.upsertSource({
        workspaceId,
        path: pathValue,
        enabled: true
      })
      setSourcePath("")
      await loadSources()
    } finally {
      setBusyMessage(null)
    }
  }

  const toggleSourceEnabled = async (source: RagSource): Promise<void> => {
    setBusyMessage(`${source.enabled ? "Disabling" : "Enabling"} source...`)
    try {
      await window.api.memory.upsertSource({
        sourceId: source.id,
        workspaceId,
        path: source.path,
        enabled: !source.enabled,
        includeGlobs: source.includeGlobs,
        excludeGlobs: source.excludeGlobs
      })
      await loadSources()
    } finally {
      setBusyMessage(null)
    }
  }

  const removeSource = async (sourceId: string): Promise<void> => {
    setBusyMessage("Removing source...")
    try {
      await window.api.memory.deleteSource(sourceId)
      await loadSources()
    } finally {
      setBusyMessage(null)
    }
  }

  const indexSources = async (sourceIds?: string[]): Promise<void> => {
    if (!currentThreadId) {
      setBusyMessage("Open a thread and link a workspace folder before indexing.")
      return
    }

    setBusyMessage("Indexing sources...")
    try {
      const result = await window.api.memory.indexSources({
        threadId: currentThreadId,
        workspaceId,
        sourceIds
      })
      await loadSources()
      setBusyMessage(
        `Indexed ${result.indexedChunks} chunks across ${result.indexedFiles} files (${result.indexedSources} sources).`
      )
    } catch (error) {
      setBusyMessage(`Indexing failed: ${error instanceof Error ? error.message : "Unknown error"}`)
    }
  }

  const runSearch = async (): Promise<void> => {
    const search = query.trim()
    if (!search) {
      setResults([])
      return
    }

    setBusyMessage("Searching memory and indexed knowledge...")
    try {
      const response = await window.api.memory.search(search, workspaceId, 8)
      setResults(response)
    } finally {
      setBusyMessage(null)
    }
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden border-r border-border">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <div>
            <div className="text-section-header">MEMORY LAYERS</div>
            <div className="mt-1 text-xs text-muted-foreground">Workspace: {workspaceId}</div>
          </div>
          <Button variant="outline" size="sm" className="h-8 gap-1.5" onClick={refreshAll}>
            <RefreshCcw className="size-3.5" />
            Refresh
          </Button>
        </div>

        <div className="grid grid-cols-1 gap-4 overflow-auto p-4 xl:grid-cols-[340px_1fr]">
          <div className="space-y-4">
            <div className="rounded-sm border border-border p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Add Memory Entry
              </div>
              <div className="space-y-2">
                <select
                  value={entryScope}
                  onChange={(event) => setEntryScope(event.target.value as MemoryEntryScope)}
                  className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                >
                  <option value="workspace">Workspace shared</option>
                  <option value="agent">Agent private</option>
                  <option value="session">Session</option>
                </select>
                {entryScope === "agent" && (
                  <select
                    value={entryAgentId}
                    onChange={(event) => setEntryAgentId(event.target.value)}
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
                  value={entryTitle}
                  onChange={(event) => setEntryTitle(event.target.value)}
                  className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                  placeholder="Title (optional)"
                />
                <textarea
                  value={entryContent}
                  onChange={(event) => setEntryContent(event.target.value)}
                  className="h-28 w-full rounded-sm border border-input bg-background px-2 py-1.5 text-xs"
                  placeholder="Memory content"
                />
                <input
                  value={entryTags}
                  onChange={(event) => setEntryTags(event.target.value)}
                  className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
                  placeholder="tags, comma, separated"
                />
                <Button size="sm" className="h-8 w-full" onClick={createEntry}>
                  Save entry
                </Button>
              </div>
            </div>

            <div className="rounded-sm border border-border p-3">
              <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Filter Entries
              </div>
              <select
                value={scopeFilter}
                onChange={(event) => setScopeFilter(event.target.value as ScopeFilter)}
                className="h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
              >
                <option value="all">All scopes</option>
                <option value="workspace">Workspace</option>
                <option value="agent">Agent</option>
                <option value="session">Session</option>
              </select>
            </div>
          </div>

          <div className="space-y-3">
            {entries.length === 0 ? (
              <div className="rounded-sm border border-border p-6 text-center text-sm text-muted-foreground">
                <BookText className="mx-auto mb-2 size-5 opacity-60" />
                No memory entries found.
              </div>
            ) : (
              entries.map((entry) => (
                <div key={entry.id} className="rounded-sm border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="text-sm font-medium">{entry.title || "Untitled memory"}</div>
                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Badge variant="outline">{toScopeLabel(entry.scope)}</Badge>
                        {entry.locked && <Badge variant="warning">Locked</Badge>}
                        {entry.agentId && (
                          <span>Agent: {agentNameById.get(entry.agentId) || entry.agentId}</span>
                        )}
                        {entry.threadId && <span>Thread: {entry.threadId.slice(0, 8)}</span>}
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7"
                      onClick={() => {
                        void toggleEntryLock(entry)
                      }}
                    >
                      {entry.locked ? (
                        <LockOpen className="size-3.5" />
                      ) : (
                        <Lock className="size-3.5" />
                      )}
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7"
                      onClick={() => {
                        void restoreEntryAsNew(entry)
                      }}
                    >
                      <RotateCcw className="size-3.5" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7"
                      disabled={entry.locked}
                      onClick={() => {
                        void removeEntry(entry.id)
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <p className="mt-2 whitespace-pre-wrap text-xs text-muted-foreground">
                    {entry.content}
                  </p>
                  <div className="mt-2 text-[11px] text-muted-foreground">
                    Updated {formatTimestamp(entry.updatedAt)}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </section>

      <aside className="flex w-[360px] flex-col overflow-hidden bg-sidebar">
        <div className="border-b border-border px-4 py-3">
          <div className="text-section-header">LOCAL RAG</div>
          <div className="mt-1 text-xs text-muted-foreground">
            Configure indexed folders and retrieval checks
          </div>
        </div>

        <div className="space-y-4 overflow-auto p-4">
          <div className="rounded-sm border border-border p-3">
            <div className="mb-2 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Add Source Folder
            </div>
            <div className="flex gap-2">
              <input
                value={sourcePath}
                onChange={(event) => setSourcePath(event.target.value)}
                className="h-8 min-w-0 flex-1 rounded-sm border border-input bg-background px-2 text-xs"
                placeholder="/docs"
              />
              <Button size="sm" className="h-8 px-3" onClick={addSource}>
                Add
              </Button>
            </div>
            <Button
              size="sm"
              variant="outline"
              className="mt-2 h-8 w-full"
              disabled={!currentThreadId}
              onClick={() => {
                void indexSources()
              }}
            >
              Index All Sources
            </Button>
          </div>

          <div className="space-y-2">
            {sources.length === 0 ? (
              <div className="rounded-sm border border-border p-3 text-xs text-muted-foreground">
                No sources configured.
              </div>
            ) : (
              sources.map((source) => (
                <div key={source.id} className="rounded-sm border border-border p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate text-xs font-medium">{source.path}</div>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                        <Badge variant={source.enabled ? "nominal" : "outline"}>
                          {source.enabled ? "Enabled" : "Disabled"}
                        </Badge>
                        <Badge variant="outline">{source.status}</Badge>
                        <span>{source.chunkCount} chunks</span>
                      </div>
                      {source.lastError && (
                        <p className="mt-1 text-[11px] text-status-critical">{source.lastError}</p>
                      )}
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      className="size-7"
                      onClick={() => {
                        void removeSource(source.id)
                      }}
                    >
                      <Trash2 className="size-3.5" />
                    </Button>
                  </div>
                  <div className="mt-2 flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-7 flex-1 text-xs"
                      onClick={() => {
                        void toggleSourceEnabled(source)
                      }}
                    >
                      {source.enabled ? "Disable" : "Enable"}
                    </Button>
                    <Button
                      size="sm"
                      className="h-7 flex-1 text-xs"
                      disabled={!currentThreadId || !source.enabled}
                      onClick={() => {
                        void indexSources([source.id])
                      }}
                    >
                      Index
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          <div className="rounded-sm border border-border p-3">
            <div className="mb-2 flex items-center gap-1.5 text-xs font-medium uppercase tracking-wider text-muted-foreground">
              <Search className="size-3.5" />
              Retrieval Probe
            </div>
            <div className="flex gap-2">
              <input
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                className="h-8 min-w-0 flex-1 rounded-sm border border-input bg-background px-2 text-xs"
                placeholder="Search memory..."
              />
              <Button size="sm" className="h-8 px-3" onClick={runSearch}>
                Run
              </Button>
            </div>

            <div className="mt-3 space-y-2">
              {results.length === 0 ? (
                <div className="text-xs text-muted-foreground">No retrieval results yet.</div>
              ) : (
                results.map((result) => (
                  <div
                    key={`${result.source}-${result.id}`}
                    className="rounded-sm border border-border p-2"
                  >
                    <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                      <Database className="size-3.5" />
                      <span>{result.source.toUpperCase()}</span>
                      <span>score {result.score}</span>
                    </div>
                    {result.title && <div className="mt-1 text-xs font-medium">{result.title}</div>}
                    {result.path && (
                      <div className="mt-1 truncate text-[11px] text-muted-foreground">
                        {result.path}
                      </div>
                    )}
                    <p className="mt-1 text-xs text-muted-foreground">{result.contentSnippet}</p>
                  </div>
                ))
              )}
            </div>
          </div>

          {busyMessage && (
            <div className="rounded-sm border border-border bg-background px-3 py-2 text-xs text-muted-foreground">
              {busyMessage}
            </div>
          )}
        </div>
      </aside>
    </div>
  )
}
