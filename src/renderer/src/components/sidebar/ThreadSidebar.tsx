import { useEffect, useState } from "react"
import {
  Plus,
  MessageSquare,
  Trash2,
  Pencil,
  Loader2,
  LayoutGrid,
  AlertCircle,
  Users,
  Network,
  Database,
  Plug,
  FileStack,
  Wrench,
  FlaskConical,
  BookText,
  Bot,
  Settings2
} from "lucide-react"
import { Button } from "@/components/ui/button"
import { ScrollArea } from "@/components/ui/scroll-area"
import { useAppStore } from "@/lib/store"
import { useThreadStream, useCurrentThread } from "@/lib/thread-context"
import { cn, formatRelativeTime, truncate } from "@/lib/utils"
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuTrigger
} from "@/components/ui/context-menu"
import type { Thread } from "@/types"

type ThreadFilterMode = "all" | "active" | "blocked" | "zeroclaw"

function getThreadTags(thread: Thread): string[] {
  const metadata = thread.metadata
  if (!metadata || typeof metadata !== "object") {
    return []
  }

  const rawTags = (metadata as Record<string, unknown>).tags
  if (!Array.isArray(rawTags)) {
    return []
  }

  return rawTags.filter((tag): tag is string => typeof tag === "string" && tag.trim().length > 0)
}

function getThreadSpeakerType(thread: Thread): string | null {
  const metadata = thread.metadata
  if (!metadata || typeof metadata !== "object") {
    return null
  }

  const speakerType = (metadata as Record<string, unknown>).speakerType
  return typeof speakerType === "string" ? speakerType : null
}

function isZeroClawThread(thread: Thread): boolean {
  return getThreadSpeakerType(thread) === "zeroclaw"
}

// Thread status indicator that shows loading, interrupted, or default state
function ThreadStatusIcon({ threadId }: { threadId: string }): React.JSX.Element {
  const { isLoading } = useThreadStream(threadId)
  const { pendingApproval } = useCurrentThread(threadId)

  if (isLoading) {
    return <Loader2 className="size-4 shrink-0 text-status-info animate-spin" />
  }

  if (pendingApproval) {
    return <AlertCircle className="size-4 shrink-0 text-status-warning" />
  }

  return <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
}

// Individual thread list item component
function ThreadListItem({
  thread,
  isSelected,
  isEditing,
  editingTitle,
  onSelect,
  onDelete,
  onStartEditing,
  onSaveTitle,
  onCancelEditing,
  onEditingTitleChange
}: {
  thread: Thread
  isSelected: boolean
  isEditing: boolean
  editingTitle: string
  onSelect: () => void
  onDelete: () => void
  onStartEditing: () => void
  onSaveTitle: () => void
  onCancelEditing: () => void
  onEditingTitleChange: (value: string) => void
}): React.JSX.Element {
  const tags = getThreadTags(thread)
  const zeroClawThread = isZeroClawThread(thread)

  return (
    <ContextMenu>
      <ContextMenuTrigger asChild>
        <div
          className={cn(
            "group flex items-center gap-2 rounded-sm px-3 py-2 cursor-pointer transition-colors overflow-hidden",
            isSelected
              ? "bg-sidebar-accent text-sidebar-accent-foreground"
              : "hover:bg-sidebar-accent/50"
          )}
          onClick={() => {
            if (!isEditing) {
              onSelect()
            }
          }}
        >
          <ThreadStatusIcon threadId={thread.thread_id} />
          <div className="flex-1 min-w-0 overflow-hidden">
            {isEditing ? (
              <input
                type="text"
                value={editingTitle}
                onChange={(e) => onEditingTitleChange(e.target.value)}
                onBlur={onSaveTitle}
                onKeyDown={(e) => {
                  if (e.key === "Enter") onSaveTitle()
                  if (e.key === "Escape") onCancelEditing()
                }}
                className="w-full bg-background border border-border rounded px-1 py-0.5 text-sm outline-none focus:ring-1 focus:ring-ring"
                autoFocus
                onClick={(e) => e.stopPropagation()}
              />
            ) : (
              <>
                <div className="text-sm truncate block">
                  {thread.title || truncate(thread.thread_id, 20)}
                </div>
                <div className="mt-0.5 flex flex-wrap items-center gap-1 text-[10px] text-muted-foreground">
                  <span className="truncate">{formatRelativeTime(thread.updated_at)}</span>
                  {thread.status !== "idle" && (
                    <span className="rounded-sm border border-border/60 bg-background/60 px-1 py-0.5 uppercase tracking-wide">
                      {thread.status}
                    </span>
                  )}
                  {zeroClawThread && (
                    <span className="inline-flex items-center gap-1 rounded-sm border border-border/60 bg-background/60 px-1 py-0.5">
                      <Bot className="size-2.5" />
                      ZeroClaw
                    </span>
                  )}
                  {tags.slice(0, 2).map((tag) => (
                    <span
                      key={`${thread.thread_id}:${tag}`}
                      className="rounded-sm border border-border/60 bg-background/60 px-1 py-0.5"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </>
            )}
          </div>
          <Button
            variant="ghost"
            size="icon-sm"
            className="opacity-0 group-hover:opacity-100 shrink-0"
            onClick={(e) => {
              e.stopPropagation()
              onDelete()
            }}
          >
            <Trash2 className="size-3" />
          </Button>
        </div>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={onStartEditing}>
          <Pencil className="size-4 mr-2" />
          Rename
        </ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem variant="destructive" onClick={onDelete}>
          <Trash2 className="size-4 mr-2" />
          Delete
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  )
}

export function ThreadSidebar(): React.JSX.Element {
  const {
    threads,
    currentThreadId,
    createThread,
    selectThread,
    deleteThread,
    updateThread,
    setShowKanbanView,
    setShowAgentsView,
    setShowGraphView,
    setShowMemoryView,
    setShowConnectorsView,
    setShowToolsView,
    setShowPromptsView,
    setShowHarnessView,
    setShowZeroClawView,
    setShowSettingsView,
    setShowTemplatesView
  } = useAppStore()

  const [editingThreadId, setEditingThreadId] = useState<string | null>(null)
  const [editingTitle, setEditingTitle] = useState("")
  const [searchQuery, setSearchQuery] = useState("")
  const [filterMode, setFilterMode] = useState<ThreadFilterMode>("all")
  const [harnessEnabled, setHarnessEnabled] = useState(true)

  useEffect(() => {
    let mounted = true
    window.api.harness
      .isEnabled()
      .then((result) => {
        if (!mounted) {
          return
        }
        setHarnessEnabled(result.enabled)
      })
      .catch(() => {
        if (!mounted) {
          return
        }
        setHarnessEnabled(true)
      })
    return () => {
      mounted = false
    }
  }, [])

  const normalizedQuery = searchQuery.trim().toLowerCase()
  const visibleThreads = threads.filter((thread) => {
    if (filterMode === "active" && thread.status !== "busy") {
      return false
    }
    if (filterMode === "blocked" && thread.status !== "interrupted" && thread.status !== "error") {
      return false
    }
    if (filterMode === "zeroclaw" && !isZeroClawThread(thread)) {
      return false
    }

    if (!normalizedQuery) {
      return true
    }

    const title = (thread.title || "").toLowerCase()
    const id = thread.thread_id.toLowerCase()
    const tags = getThreadTags(thread).join(" ").toLowerCase()
    const speakerType = (getThreadSpeakerType(thread) || "").toLowerCase()
    return (
      title.includes(normalizedQuery) ||
      id.includes(normalizedQuery) ||
      tags.includes(normalizedQuery) ||
      speakerType.includes(normalizedQuery)
    )
  })

  const startEditing = (threadId: string, currentTitle: string): void => {
    setEditingThreadId(threadId)
    setEditingTitle(currentTitle || "")
  }

  const saveTitle = async (): Promise<void> => {
    if (editingThreadId && editingTitle.trim()) {
      await updateThread(editingThreadId, { title: editingTitle.trim() })
    }
    setEditingThreadId(null)
    setEditingTitle("")
  }

  const cancelEditing = (): void => {
    setEditingThreadId(null)
    setEditingTitle("")
  }

  const handleNewThread = async (): Promise<void> => {
    await createThread({ title: `Thread ${new Date().toLocaleDateString()}` })
  }

  return (
    <aside className="flex h-full w-full flex-col border-r border-border bg-sidebar overflow-hidden">
      {/* New Thread Button - with dynamic safe area padding when zoomed out */}
      <div className="p-2" style={{ paddingTop: "calc(8px + var(--sidebar-safe-padding, 0px))" }}>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={handleNewThread}
        >
          <Plus className="size-4" />
          New Thread
        </Button>
        <input
          value={searchQuery}
          onChange={(event) => setSearchQuery(event.target.value)}
          className="mt-2 h-8 w-full rounded-sm border border-input bg-background px-2 text-xs"
          placeholder="Search sessions..."
        />
        <div className="mt-2 flex gap-1">
          <Button
            variant={filterMode === "all" ? "default" : "outline"}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setFilterMode("all")}
          >
            All
          </Button>
          <Button
            variant={filterMode === "active" ? "default" : "outline"}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setFilterMode("active")}
          >
            Active
          </Button>
          <Button
            variant={filterMode === "blocked" ? "default" : "outline"}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setFilterMode("blocked")}
          >
            Blocked
          </Button>
          <Button
            variant={filterMode === "zeroclaw" ? "default" : "outline"}
            size="sm"
            className="h-6 px-2 text-[10px]"
            onClick={() => setFilterMode("zeroclaw")}
          >
            ZeroClaw
          </Button>
        </div>
      </div>

      {/* Thread List */}
      <ScrollArea className="flex-1 min-h-0">
        <div className="p-2 space-y-1 overflow-hidden">
          {visibleThreads.map((thread) => (
            <ThreadListItem
              key={thread.thread_id}
              thread={thread}
              isSelected={currentThreadId === thread.thread_id}
              isEditing={editingThreadId === thread.thread_id}
              editingTitle={editingTitle}
              onSelect={() => selectThread(thread.thread_id)}
              onDelete={() => deleteThread(thread.thread_id)}
              onStartEditing={() => startEditing(thread.thread_id, thread.title || "")}
              onSaveTitle={saveTitle}
              onCancelEditing={cancelEditing}
              onEditingTitleChange={setEditingTitle}
            />
          ))}

          {visibleThreads.length === 0 && (
            <div className="px-3 py-8 text-center text-sm text-muted-foreground">
              {threads.length === 0 ? "No threads yet" : "No sessions match this filter"}
            </div>
          )}
        </div>
      </ScrollArea>

      {/* Overview Toggle */}
      <div className="p-2 border-t border-border">
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2"
          onClick={() => setShowKanbanView(true)}
        >
          <LayoutGrid className="size-4" />
          Home
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 mt-1"
          onClick={() => setShowAgentsView(true)}
        >
          <Users className="size-4" />
          Agents
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 mt-1"
          onClick={() => setShowGraphView(true)}
        >
          <Network className="size-4" />
          Graph
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 mt-1"
          onClick={() => setShowMemoryView(true)}
        >
          <Database className="size-4" />
          Memory
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 mt-1"
          onClick={() => setShowConnectorsView(true)}
        >
          <Plug className="size-4" />
          Connectors
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 mt-1"
          onClick={() => setShowTemplatesView(true)}
        >
          <FileStack className="size-4" />
          Templates
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 mt-1"
          onClick={() => setShowToolsView(true)}
        >
          <Wrench className="size-4" />
          Skills/Tools
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 mt-1"
          onClick={() => setShowPromptsView(true)}
        >
          <BookText className="size-4" />
          Prompts
        </Button>
        {harnessEnabled && (
          <Button
            variant="ghost"
            size="sm"
            className="w-full justify-start gap-2 mt-1"
            onClick={() => setShowHarnessView(true)}
          >
            <FlaskConical className="size-4" />
            Harness
          </Button>
        )}
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 mt-1"
          onClick={() => setShowZeroClawView(true)}
        >
          <Bot className="size-4" />
          ZeroClaw
        </Button>
        <Button
          variant="ghost"
          size="sm"
          className="w-full justify-start gap-2 mt-1"
          onClick={() => setShowSettingsView(true)}
        >
          <Settings2 className="size-4" />
          Settings
        </Button>
      </div>
    </aside>
  )
}
