import { useCallback, useEffect, useMemo, useState } from "react"
import { BookText, FolderPlus, Lock, LockOpen, RefreshCcw, Search, Trash2 } from "lucide-react"
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
  const [sourcePath, setSourcePath] = useState("")
  const [query, setQuery] = useState("")
  const [busyMessage, setBusyMessage] = useState<string | null>(null)

  const workspaceId = useMemo(() => agents[0]?.workspaceId || DEFAULT_WORKSPACE_ID, [agents])
  const agentNameById = useMemo(() => {
    const map = new Map<string, string>()
    for (const agent of agents) map.set(agent.id, agent.name)
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
    setBusyMessage("Refreshing...")
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
    if (!content) return

    setBusyMessage("Saving...")
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
          .map((i) => i.trim())
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
    setBusyMessage("Deleting...")
    try {
      await window.api.memory.deleteEntry(entryId)
      await loadEntries()
    } finally {
      setBusyMessage(null)
    }
  }

  const toggleEntryLock = async (entry: MemoryEntry): Promise<void> => {
    setBusyMessage(entry.locked ? "Unlocking..." : "Locking...")
    try {
      await window.api.memory.setEntryLocked(entry.id, !entry.locked)
      await loadEntries()
    } finally {
      setBusyMessage(null)
    }
  }

  const addSource = async (): Promise<void> => {
    const pathValue = sourcePath.trim()
    if (!pathValue) return
    setBusyMessage("Adding source...")
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

  const removeSource = async (sourceId: string): Promise<void> => {
    setBusyMessage("Removing...")
    try {
      await window.api.memory.deleteSource(sourceId)
      await loadSources()
    } finally {
      setBusyMessage(null)
    }
  }

  const indexSources = async (): Promise<void> => {
    if (!currentThreadId) {
      setBusyMessage("Open a thread first.")
      return
    }
    setBusyMessage("Indexing...")
    try {
      const result = await window.api.memory.indexSources({
        threadId: currentThreadId,
        workspaceId
      })
      await loadSources()
      setBusyMessage(`Indexed ${result.indexedChunks} chunks from ${result.indexedFiles} files.`)
    } catch (error) {
      setBusyMessage(`Error: ${error instanceof Error ? error.message : "Unknown"}`)
    }
  }

  const runSearch = async (): Promise<void> => {
    const search = query.trim()
    if (!search) {
      setResults([])
      return
    }
    setBusyMessage("Searching...")
    try {
      const response = await window.api.memory.search(search, workspaceId, 8)
      setResults(response)
    } finally {
      setBusyMessage(null)
    }
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      {/* Main Content */}
      <section className="flex min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-border/50 px-6 py-4">
          <div>
            <h1 className="text-base font-medium">Memory</h1>
            <p className="mt-0.5 text-xs text-muted-foreground">{workspaceId}</p>
          </div>
          <Button variant="outline" size="sm" onClick={refreshAll}>
            <RefreshCcw className="mr-1.5 size-3.5" />
            Refresh
          </Button>
        </div>

        <div className="flex flex-1 gap-6 overflow-hidden p-6">
          {/* Left: Add Entry Form */}
          <div className="w-80 shrink-0 space-y-4">
            <div className="rounded-lg border border-border/40 p-4">
              <h2 className="text-xs font-medium text-muted-foreground">Add Memory Entry</h2>
              <div className="mt-3 space-y-3">
                <select
                  value={entryScope}
                  onChange={(e) => setEntryScope(e.target.value as MemoryEntryScope)}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                >
                  <option value="workspace">Workspace shared</option>
                  <option value="agent">Agent private</option>
                  <option value="session">Session</option>
                </select>
                {entryScope === "agent" && (
                  <select
                    value={entryAgentId}
                    onChange={(e) => setEntryAgentId(e.target.value)}
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
                  value={entryTitle}
                  onChange={(e) => setEntryTitle(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  placeholder="Title (optional)"
                />
                <textarea
                  value={entryContent}
                  onChange={(e) => setEntryContent(e.target.value)}
                  className="min-h-[100px] w-full rounded-md border border-border/60 bg-background p-3 text-sm"
                  placeholder="Memory content..."
                />
                <input
                  value={entryTags}
                  onChange={(e) => setEntryTags(e.target.value)}
                  className="h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
                  placeholder="Tags (comma separated)"
                />
                <Button size="sm" className="w-full" onClick={createEntry}>
                  Save Entry
                </Button>
              </div>
            </div>

            <div className="rounded-lg border border-border/40 p-4">
              <h2 className="text-xs font-medium text-muted-foreground">Filter</h2>
              <select
                value={scopeFilter}
                onChange={(e) => setScopeFilter(e.target.value as ScopeFilter)}
                className="mt-2 h-9 w-full rounded-md border border-border/60 bg-background px-3 text-sm"
              >
                <option value="all">All scopes</option>
                <option value="workspace">Workspace</option>
                <option value="agent">Agent</option>
                <option value="session">Session</option>
              </select>
            </div>

            {busyMessage && <p className="text-xs text-muted-foreground">{busyMessage}</p>}
          </div>

          {/* Center: Memory Entries */}
          <div className="min-w-0 flex-1 overflow-auto">
            {entries.length === 0 ? (
              <div className="empty-state">
                <BookText className="empty-state-icon" />
                <p className="text-sm text-muted-foreground">No memory entries</p>
              </div>
            ) : (
              <div className="space-y-2">
                {entries.map((entry) => (
                  <div
                    key={entry.id}
                    className="rounded-lg border border-border/40 bg-card/50 p-4 transition-colors hover:border-border"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-medium">{entry.title || "Untitled"}</p>
                        <div className="mt-1 flex items-center gap-2">
                          <Badge variant="outline" className="text-[10px]">
                            {toScopeLabel(entry.scope)}
                          </Badge>
                          {entry.locked && (
                            <Badge variant="warning" className="text-[10px]">
                              Locked
                            </Badge>
                          )}
                          {entry.agentId && (
                            <span className="text-[10px] text-muted-foreground">
                              {agentNameById.get(entry.agentId) || entry.agentId}
                            </span>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          onClick={() => void toggleEntryLock(entry)}
                        >
                          {entry.locked ? (
                            <LockOpen className="size-3.5" />
                          ) : (
                            <Lock className="size-3.5" />
                          )}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-7 w-7 p-0"
                          disabled={entry.locked}
                          onClick={() => void removeEntry(entry.id)}
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                    <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">
                      {entry.content}
                    </p>
                    <p className="mt-2 text-[10px] text-muted-foreground/60">
                      {formatTimestamp(entry.updatedAt)}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* Right Sidebar: RAG Sources */}
      <aside className="flex w-80 flex-col border-l border-border/50 bg-sidebar/50">
        <div className="border-b border-border/30 px-4 py-3">
          <h2 className="text-xs font-medium text-muted-foreground">Local RAG</h2>
          <p className="mt-0.5 text-[10px] text-muted-foreground/60">Index folders for retrieval</p>
        </div>

        <div className="flex-1 space-y-4 overflow-auto p-4">
          {/* Add Source */}
          <div className="space-y-2">
            <div className="flex gap-2">
              <input
                value={sourcePath}
                onChange={(e) => setSourcePath(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-3 text-sm"
                placeholder="/path/to/docs"
              />
              <Button size="sm" className="h-9 px-3" onClick={addSource}>
                <FolderPlus className="size-4" />
              </Button>
            </div>
            <Button
              variant="outline"
              size="sm"
              className="w-full"
              disabled={!currentThreadId}
              onClick={() => void indexSources()}
            >
              Index All Sources
            </Button>
          </div>

          {/* Sources List */}
          <div className="space-y-2">
            {sources.length === 0 ? (
              <p className="text-xs text-muted-foreground">No sources configured.</p>
            ) : (
              sources.map((source) => (
                <div key={source.id} className="rounded-md border border-border/40 bg-card/50 p-3">
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-sm font-medium">{source.path}</p>
                      <div className="mt-1 flex items-center gap-2">
                        <Badge
                          variant={source.enabled ? "nominal" : "outline"}
                          className="text-[9px]"
                        >
                          {source.enabled ? "Active" : "Disabled"}
                        </Badge>
                        <span className="text-[10px] text-muted-foreground">
                          {source.chunkCount} chunks
                        </span>
                      </div>
                    </div>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-6 w-6 p-0"
                      onClick={() => void removeSource(source.id)}
                    >
                      <Trash2 className="size-3" />
                    </Button>
                  </div>
                </div>
              ))
            )}
          </div>

          {/* Search */}
          <div className="border-t border-border/30 pt-4">
            <div className="flex items-center gap-2 text-xs font-medium text-muted-foreground">
              <Search className="size-3.5" />
              Retrieval Test
            </div>
            <div className="mt-2 flex gap-2">
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-9 min-w-0 flex-1 rounded-md border border-border/60 bg-background px-3 text-sm"
                placeholder="Search..."
              />
              <Button size="sm" className="h-9 px-3" onClick={runSearch}>
                Run
              </Button>
            </div>
            <div className="mt-3 space-y-2">
              {results.length === 0 ? (
                <p className="text-[10px] text-muted-foreground">No results</p>
              ) : (
                results.map((r) => (
                  <div
                    key={`${r.source}-${r.id}`}
                    className="rounded-md border border-border/40 p-2"
                  >
                    <div className="flex items-center gap-2 text-[10px] text-muted-foreground">
                      <span className="uppercase">{r.source}</span>
                      <span>score {r.score.toFixed(2)}</span>
                    </div>
                    {r.title && <p className="mt-1 text-xs font-medium">{r.title}</p>}
                    <p className="mt-1 line-clamp-2 text-[10px] text-muted-foreground">
                      {r.contentSnippet}
                    </p>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </aside>
    </div>
  )
}
