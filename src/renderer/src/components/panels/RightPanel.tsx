import { useState, useRef, useCallback, useEffect, useMemo, memo } from "react"
import {
  ListTodo,
  FolderTree,
  GitBranch,
  History,
  ChevronRight,
  ChevronDown,
  CheckCircle2,
  Circle,
  Clock,
  XCircle,
  GripHorizontal,
  Download,
  FolderSync,
  Loader2,
  Check,
  Folder,
  FolderOpen,
  File,
  FileText,
  FileCode,
  FileJson,
  Image,
  FileType,
  MessageSquare,
  ShieldAlert,
  UserRound,
  Wrench
} from "lucide-react"
import { cn } from "@/lib/utils"
import { useAppStore } from "@/lib/store"
import { useThreadState, useThreadStream } from "@/lib/thread-context"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import type { Message, TimelineEvent, Todo } from "@/types"

const HEADER_HEIGHT = 40 // px
const HANDLE_HEIGHT = 6 // px
const MIN_CONTENT_HEIGHT = 60 // px
const COLLAPSE_THRESHOLD = 55 // px - auto-collapse when below this

interface SectionHeaderProps {
  title: string
  icon: React.ElementType
  badge?: number
  isOpen: boolean
  onToggle: () => void
}

function SectionHeader({
  title,
  icon: Icon,
  badge,
  isOpen,
  onToggle
}: SectionHeaderProps): React.JSX.Element {
  return (
    <button
      onClick={onToggle}
      className="flex items-center gap-2 px-3 py-2.5 text-section-header hover:bg-background-interactive transition-colors shrink-0 w-full"
      style={{ height: HEADER_HEIGHT }}
    >
      <ChevronRight
        className={cn(
          "size-3.5 text-muted-foreground transition-transform duration-200",
          isOpen && "rotate-90"
        )}
      />
      <Icon className="size-4" />
      <span className="flex-1 text-left">{title}</span>
      {badge !== undefined && badge > 0 && (
        <span className="text-[10px] text-muted-foreground tabular-nums">{badge}</span>
      )}
    </button>
  )
}

interface ResizeHandleProps {
  onDrag: (delta: number) => void
}

function ResizeHandle({ onDrag }: ResizeHandleProps): React.JSX.Element {
  const startYRef = useRef<number>(0)

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault()
      startYRef.current = e.clientY

      const handleMouseMove = (e: MouseEvent): void => {
        // Calculate total delta from drag start
        const totalDelta = e.clientY - startYRef.current
        onDrag(totalDelta)
      }

      const handleMouseUp = (): void => {
        document.removeEventListener("mousemove", handleMouseMove)
        document.removeEventListener("mouseup", handleMouseUp)
        document.body.style.cursor = ""
        document.body.style.userSelect = ""
      }

      document.addEventListener("mousemove", handleMouseMove)
      document.addEventListener("mouseup", handleMouseUp)
      document.body.style.cursor = "row-resize"
      document.body.style.userSelect = "none"
    },
    [onDrag]
  )

  return (
    <div
      onMouseDown={handleMouseDown}
      className="group bg-border/50 hover:bg-primary/30 active:bg-primary/50 transition-colors cursor-row-resize flex items-center justify-center shrink-0 select-none"
      style={{ height: HANDLE_HEIGHT }}
    >
      <GripHorizontal className="size-4 text-muted-foreground/50 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
    </div>
  )
}

export function RightPanel(): React.JSX.Element {
  const { currentThreadId } = useAppStore()
  const threadState = useThreadState(currentThreadId)
  const streamData = useThreadStream(currentThreadId || "__no_thread__")
  const todos = threadState?.todos ?? []
  const messages = threadState?.messages ?? []
  const workspaceFiles = threadState?.workspaceFiles ?? []
  const subagents = threadState?.subagents ?? []
  const pendingApproval = threadState?.pendingApproval ?? null
  const containerRef = useRef<HTMLDivElement>(null)

  const [tasksOpen, setTasksOpen] = useState(true)
  const [filesOpen, setFilesOpen] = useState(true)
  const [agentsOpen, setAgentsOpen] = useState(true)

  // Store content heights in pixels (null = auto/equal distribution)
  const [tasksHeight, setTasksHeight] = useState<number | null>(null)
  const [filesHeight, setFilesHeight] = useState<number | null>(null)
  const [agentsHeight, setAgentsHeight] = useState<number | null>(null)

  // Track drag start heights
  const dragStartHeights = useRef<{ tasks: number; files: number; agents: number } | null>(null)

  // Calculate available content height
  const getAvailableContentHeight = useCallback(() => {
    if (!containerRef.current) return 0
    const totalHeight = containerRef.current.clientHeight

    // Subtract headers (always visible)
    let used = HEADER_HEIGHT * 3

    // Subtract handles (only between open panels)
    if (tasksOpen && (filesOpen || agentsOpen)) used += HANDLE_HEIGHT
    if (filesOpen && agentsOpen) used += HANDLE_HEIGHT

    return Math.max(0, totalHeight - used)
  }, [tasksOpen, filesOpen, agentsOpen])

  // Get current heights for each panel's content area
  const getContentHeights = useCallback(() => {
    const available = getAvailableContentHeight()
    const openCount = [tasksOpen, filesOpen, agentsOpen].filter(Boolean).length

    if (openCount === 0) {
      return { tasks: 0, files: 0, agents: 0 }
    }

    const defaultHeight = available / openCount

    return {
      tasks: tasksOpen ? (tasksHeight ?? defaultHeight) : 0,
      files: filesOpen ? (filesHeight ?? defaultHeight) : 0,
      agents: agentsOpen ? (agentsHeight ?? defaultHeight) : 0
    }
  }, [
    getAvailableContentHeight,
    tasksOpen,
    filesOpen,
    agentsOpen,
    tasksHeight,
    filesHeight,
    agentsHeight
  ])

  // Handle resize between tasks and the next open section
  const handleTasksResize = useCallback(
    (totalDelta: number) => {
      if (!dragStartHeights.current) {
        const heights = getContentHeights()
        dragStartHeights.current = { ...heights }
      }

      const start = dragStartHeights.current
      const available = getAvailableContentHeight()

      // Determine which panel is being resized against
      const otherStart = filesOpen ? start.files : start.agents

      // Calculate new heights with proper clamping
      let newTasksHeight = start.tasks + totalDelta
      let newOtherHeight = otherStart - totalDelta

      // Clamp both to min height
      if (newTasksHeight < MIN_CONTENT_HEIGHT) {
        newTasksHeight = MIN_CONTENT_HEIGHT
        newOtherHeight = otherStart + (start.tasks - MIN_CONTENT_HEIGHT)
      }
      if (newOtherHeight < MIN_CONTENT_HEIGHT) {
        newOtherHeight = MIN_CONTENT_HEIGHT
        newTasksHeight = start.tasks + (otherStart - MIN_CONTENT_HEIGHT)
      }

      // Ensure total doesn't exceed available (accounting for third panel if open)
      const thirdPanelHeight = filesOpen && agentsOpen ? (agentsHeight ?? available / 3) : 0
      const maxForTwo = available - thirdPanelHeight
      if (newTasksHeight + newOtherHeight > maxForTwo) {
        const excess = newTasksHeight + newOtherHeight - maxForTwo
        if (totalDelta > 0) {
          newOtherHeight = Math.max(MIN_CONTENT_HEIGHT, newOtherHeight - excess)
        } else {
          newTasksHeight = Math.max(MIN_CONTENT_HEIGHT, newTasksHeight - excess)
        }
      }

      setTasksHeight(newTasksHeight)
      if (filesOpen) {
        setFilesHeight(newOtherHeight)
      } else if (agentsOpen) {
        setAgentsHeight(newOtherHeight)
      }

      // Auto-collapse if below threshold
      if (newTasksHeight < COLLAPSE_THRESHOLD) {
        setTasksOpen(false)
      }
      if (newOtherHeight < COLLAPSE_THRESHOLD) {
        if (filesOpen) setFilesOpen(false)
        else if (agentsOpen) setAgentsOpen(false)
      }
    },
    [getContentHeights, getAvailableContentHeight, filesOpen, agentsOpen, agentsHeight]
  )

  // Handle resize between files and agents
  const handleFilesResize = useCallback(
    (totalDelta: number) => {
      if (!dragStartHeights.current) {
        const heights = getContentHeights()
        dragStartHeights.current = { ...heights }
      }

      const start = dragStartHeights.current
      const available = getAvailableContentHeight()
      const tasksH = tasksOpen ? (tasksHeight ?? available / 3) : 0
      const maxForFilesAndAgents = available - tasksH

      // Calculate new heights with proper clamping
      let newFilesHeight = start.files + totalDelta
      let newAgentsHeight = start.agents - totalDelta

      // Clamp both to min height
      if (newFilesHeight < MIN_CONTENT_HEIGHT) {
        newFilesHeight = MIN_CONTENT_HEIGHT
        newAgentsHeight = start.agents + (start.files - MIN_CONTENT_HEIGHT)
      }
      if (newAgentsHeight < MIN_CONTENT_HEIGHT) {
        newAgentsHeight = MIN_CONTENT_HEIGHT
        newFilesHeight = start.files + (start.agents - MIN_CONTENT_HEIGHT)
      }

      // Ensure total doesn't exceed available
      if (newFilesHeight + newAgentsHeight > maxForFilesAndAgents) {
        const excess = newFilesHeight + newAgentsHeight - maxForFilesAndAgents
        if (totalDelta > 0) {
          newAgentsHeight = Math.max(MIN_CONTENT_HEIGHT, newAgentsHeight - excess)
        } else {
          newFilesHeight = Math.max(MIN_CONTENT_HEIGHT, newFilesHeight - excess)
        }
      }

      setFilesHeight(newFilesHeight)
      setAgentsHeight(newAgentsHeight)

      // Auto-collapse if below threshold
      if (newFilesHeight < COLLAPSE_THRESHOLD) {
        setFilesOpen(false)
      }
      if (newAgentsHeight < COLLAPSE_THRESHOLD) {
        setAgentsOpen(false)
      }
    },
    [getContentHeights, getAvailableContentHeight, tasksOpen, tasksHeight]
  )

  // Reset drag start on mouse up
  useEffect(() => {
    const handleMouseUp = (): void => {
      dragStartHeights.current = null
    }
    document.addEventListener("mouseup", handleMouseUp)
    return () => document.removeEventListener("mouseup", handleMouseUp)
  }, [])

  // Reset heights when panels open/close to redistribute
  useEffect(() => {
    setTasksHeight(null)
    setFilesHeight(null)
    setAgentsHeight(null)
  }, [tasksOpen, filesOpen, agentsOpen])

  // Calculate heights in an effect (refs can't be accessed during render)
  const [heights, setHeights] = useState({ tasks: 0, files: 0, agents: 0 })
  useEffect(() => {
    setHeights(getContentHeights())
  }, [getContentHeights])

  const timelineBadge = useMemo(() => {
    const streamMessageCount = Array.isArray(streamData.messages) ? streamData.messages.length : 0
    return messages.length + streamMessageCount + subagents.length + (pendingApproval ? 1 : 0)
  }, [messages.length, pendingApproval, streamData.messages, subagents.length])

  return (
    <aside
      ref={containerRef}
      className="flex h-full w-full flex-col border-l border-border bg-sidebar overflow-hidden"
    >
      {/* TASKS */}
      <div className="flex flex-col shrink-0 border-b border-border">
        <SectionHeader
          title="TASKS"
          icon={ListTodo}
          badge={todos.length}
          isOpen={tasksOpen}
          onToggle={() => setTasksOpen((prev) => !prev)}
        />
        {tasksOpen && (
          <div className="overflow-auto" style={{ height: heights.tasks }}>
            <TasksContent />
          </div>
        )}
      </div>

      {/* Resize handle after TASKS */}
      {tasksOpen && (filesOpen || agentsOpen) && <ResizeHandle onDrag={handleTasksResize} />}

      {/* FILES */}
      <div className="flex flex-col shrink-0 border-b border-border">
        <SectionHeader
          title="FILES"
          icon={FolderTree}
          badge={workspaceFiles.length}
          isOpen={filesOpen}
          onToggle={() => setFilesOpen((prev) => !prev)}
        />
        {filesOpen && (
          <div className="overflow-auto" style={{ height: heights.files }}>
            <FilesContent />
          </div>
        )}
      </div>

      {/* Resize handle after FILES */}
      {filesOpen && agentsOpen && <ResizeHandle onDrag={handleFilesResize} />}

      {/* AGENTS */}
      <div className="flex flex-col shrink-0">
        <SectionHeader
          title="TIMELINE"
          icon={History}
          badge={timelineBadge}
          isOpen={agentsOpen}
          onToggle={() => setAgentsOpen((prev) => !prev)}
        />
        {agentsOpen && (
          <div className="overflow-auto" style={{ height: heights.agents }}>
            <TimelineContent />
          </div>
        )}
      </div>
    </aside>
  )
}

// ============ Content Components ============

const STATUS_CONFIG = {
  pending: {
    icon: Circle,
    badge: "outline" as const,
    label: "PENDING",
    color: "text-muted-foreground"
  },
  in_progress: {
    icon: Clock,
    badge: "info" as const,
    label: "IN PROGRESS",
    color: "text-status-info"
  },
  completed: {
    icon: CheckCircle2,
    badge: "nominal" as const,
    label: "DONE",
    color: "text-status-nominal"
  },
  cancelled: {
    icon: XCircle,
    badge: "critical" as const,
    label: "CANCELLED",
    color: "text-muted-foreground"
  }
}

function TasksContent(): React.JSX.Element {
  const { currentThreadId } = useAppStore()
  const threadState = useThreadState(currentThreadId)
  const todos = threadState?.todos ?? []
  const [completedExpanded, setCompletedExpanded] = useState(false)

  if (todos.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-8 px-4">
        <ListTodo className="size-8 mb-2 opacity-50" />
        <span>No tasks yet</span>
        <span className="text-xs mt-1">Tasks appear when the agent creates them</span>
      </div>
    )
  }

  const inProgress = todos.filter((t) => t.status === "in_progress")
  const pending = todos.filter((t) => t.status === "pending")
  const completed = todos.filter((t) => t.status === "completed")
  const cancelled = todos.filter((t) => t.status === "cancelled")

  // Completed section includes both completed and cancelled
  const doneItems = [...completed, ...cancelled]

  const done = completed.length
  const total = todos.length
  const progress = total > 0 ? Math.round((done / total) * 100) : 0

  return (
    <div>
      {/* Progress bar */}
      <div className="p-3 border-b border-border/50">
        <div className="flex items-center justify-between mb-1.5 text-xs">
          <span className="text-muted-foreground">PROGRESS</span>
          <span className="font-mono">
            {done}/{total}
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-background overflow-hidden">
          <div
            className="h-full bg-status-nominal transition-all duration-300"
            style={{ width: `${progress}%` }}
          />
        </div>
      </div>

      {/* Todo list */}
      <div className="p-3 space-y-2">
        {/* Completed/Cancelled Section (Collapsible) */}
        {doneItems.length > 0 && (
          <div className="mb-1">
            <button
              onClick={() => setCompletedExpanded(!completedExpanded)}
              className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-2 w-full"
            >
              {completedExpanded ? (
                <ChevronDown className="size-3.5" />
              ) : (
                <ChevronRight className="size-3.5" />
              )}
              <span className="uppercase tracking-wider font-medium">
                Completed ({doneItems.length})
              </span>
            </button>
            {completedExpanded && (
              <div className="space-y-2 pl-5 mb-3">
                {doneItems.map((todo) => (
                  <TaskItem key={todo.id} todo={todo} />
                ))}
              </div>
            )}
          </div>
        )}

        {/* In Progress Section */}
        {inProgress.map((todo) => (
          <TaskItem key={todo.id} todo={todo} />
        ))}

        {/* Pending Section */}
        {pending.map((todo) => (
          <TaskItem key={todo.id} todo={todo} />
        ))}
      </div>
    </div>
  )
}

function TaskItem({ todo }: { todo: Todo }): React.JSX.Element {
  const config = STATUS_CONFIG[todo.status]
  const Icon = config.icon
  const isDone = todo.status === "completed" || todo.status === "cancelled"

  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-sm border border-border p-3",
        isDone && "opacity-50"
      )}
    >
      <Icon className={cn("size-4 shrink-0 mt-0.5", config.color)} />
      <span className={cn("flex-1 text-sm", isDone && "line-through")}>{todo.content}</span>
      <Badge variant={config.badge} className="shrink-0 text-[10px]">
        {config.label}
      </Badge>
    </div>
  )
}

interface ArtifactEntry {
  id: string
  path: string
  actionLabel: string
}

function getFileArtifactPath(args: Record<string, unknown>): string | null {
  const candidates = [args.file_path, args.path]
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim().length > 0) {
      return candidate
    }
  }
  return null
}

function extractArtifactsFromMessages(messages: Message[]): ArtifactEntry[] {
  const artifactLabels: Record<string, string> = {
    write_file: "Wrote",
    edit_file: "Edited",
    read_file: "Read"
  }

  const seen = new Set<string>()
  const artifacts: ArtifactEntry[] = []

  for (const message of [...messages].reverse()) {
    if (message.role !== "assistant" || !message.tool_calls || message.tool_calls.length === 0) {
      continue
    }

    for (const toolCall of message.tool_calls) {
      const actionLabel = artifactLabels[toolCall.name]
      if (!actionLabel) {
        continue
      }
      const path = getFileArtifactPath((toolCall.args || {}) as Record<string, unknown>)
      if (!path) {
        continue
      }

      const artifactKey = `${toolCall.name}:${path}`
      if (seen.has(artifactKey)) {
        continue
      }
      seen.add(artifactKey)

      artifacts.push({
        id: `${toolCall.id}:${path}`,
        path,
        actionLabel
      })
    }
  }

  return artifacts.slice(0, 12)
}

function getFileName(path: string): string {
  const parts = path.split("/").filter(Boolean)
  return parts[parts.length - 1] || path
}

function FilesContent(): React.JSX.Element {
  const { currentThreadId } = useAppStore()
  const threadState = useThreadState(currentThreadId)
  const messages = useMemo(() => threadState?.messages ?? [], [threadState?.messages])
  const workspaceFiles = threadState?.workspaceFiles ?? []
  const workspacePath = threadState?.workspacePath ?? null
  const setWorkspacePath = threadState?.setWorkspacePath
  const setWorkspaceFiles = threadState?.setWorkspaceFiles
  const openFile = threadState?.openFile
  const [syncing, setSyncing] = useState(false)
  const [syncSuccess, setSyncSuccess] = useState(false)
  const syncSuccessTimerRef = useRef<number | null>(null)
  const artifacts = useMemo(() => extractArtifactsFromMessages(messages), [messages])

  const flashSyncSuccess = useCallback((): void => {
    if (syncSuccessTimerRef.current) {
      window.clearTimeout(syncSuccessTimerRef.current)
      syncSuccessTimerRef.current = null
    }
    setSyncSuccess(true)
    syncSuccessTimerRef.current = window.setTimeout(() => {
      setSyncSuccess(false)
      syncSuccessTimerRef.current = null
    }, 1500)
  }, [])

  useEffect(() => {
    return () => {
      if (syncSuccessTimerRef.current) {
        window.clearTimeout(syncSuccessTimerRef.current)
      }
    }
  }, [])

  // Load workspace path and files for current thread
  useEffect(() => {
    async function loadWorkspace(): Promise<void> {
      if (currentThreadId && setWorkspacePath && setWorkspaceFiles) {
        const path = await window.api.workspace.get(currentThreadId)
        setWorkspacePath(path)

        // If a folder is linked, load files from disk
        if (path) {
          const result = await window.api.workspace.loadFromDisk(currentThreadId)
          if (result.success && result.files) {
            setWorkspaceFiles(result.files)
          }
        }
      }
    }
    loadWorkspace()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentThreadId])

  // Listen for file changes from the workspace watcher
  useEffect(() => {
    if (!currentThreadId || !setWorkspaceFiles) return

    const cleanup = window.api.workspace.onFilesChanged(async (data) => {
      // Only reload if the event is for the current thread
      if (data.threadId === currentThreadId) {
        console.log("[FilesContent] Files changed, reloading...", data)
        const result = await window.api.workspace.loadFromDisk(currentThreadId)
        if (result.success && result.files) {
          setWorkspaceFiles(result.files)
        }
      }
    })

    return cleanup
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentThreadId])

  // Handle selecting a workspace folder
  async function handleSelectFolder(): Promise<void> {
    if (!currentThreadId || !setWorkspacePath || !setWorkspaceFiles) return
    setSyncing(true)
    setSyncSuccess(false)
    try {
      const path = await window.api.workspace.select(currentThreadId)
      if (path) {
        setWorkspacePath(path)
        // Load files from the newly selected folder
        const result = await window.api.workspace.loadFromDisk(currentThreadId)
        if (result.success && result.files) {
          setWorkspaceFiles(result.files)
          flashSyncSuccess()
        }
      }
    } catch (e) {
      console.error("[FilesContent] Select folder error:", e)
    } finally {
      setSyncing(false)
    }
  }

  // Handle sync to disk
  async function handleSyncToDisk(): Promise<void> {
    if (!currentThreadId || !setWorkspaceFiles) return
    setSyncing(true)
    setSyncSuccess(false)

    try {
      if (!workspacePath) {
        await handleSelectFolder()
        return
      }

      const result = await window.api.workspace.loadFromDisk(currentThreadId)
      if (result.success && result.files) {
        setWorkspaceFiles(result.files)
        flashSyncSuccess()
        return
      }

      console.warn("[FilesContent] Sync failed:", result.error || "Unknown error")
    } catch (error) {
      console.error("[FilesContent] Sync error:", error)
    } finally {
      setSyncing(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header with sync button */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border/50 bg-background/30">
        <span
          className="text-[10px] text-muted-foreground truncate flex-1"
          title={workspacePath || undefined}
        >
          {workspacePath ? workspacePath.split("/").pop() : "No folder linked"}
        </span>
        <Button
          variant="ghost"
          size="sm"
          onClick={workspaceFiles.length > 0 ? handleSyncToDisk : handleSelectFolder}
          disabled={syncing || !currentThreadId}
          className="h-5 px-1.5 text-[10px]"
          title={
            workspaceFiles.length > 0
              ? workspacePath
                ? `Sync to ${workspacePath}`
                : "Sync files to disk"
              : workspacePath
                ? `Change folder`
                : "Link sync folder"
          }
        >
          {syncing ? (
            <Loader2 className="size-3 animate-spin" />
          ) : syncSuccess ? (
            <Check className="size-3 text-status-nominal" />
          ) : workspaceFiles.length > 0 ? (
            <Download className="size-3" />
          ) : (
            <FolderSync className="size-3" />
          )}
          <span className="ml-1">
            {workspaceFiles.length > 0 ? "Sync" : workspacePath ? "Change" : "Link"}
          </span>
        </Button>
      </div>

      {artifacts.length > 0 && (
        <div className="border-b border-border/50 px-3 py-2 bg-background/20">
          <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
            Recent Artifacts
          </div>
          <div className="space-y-1">
            {artifacts.map((artifact) => (
              <button
                key={artifact.id}
                onClick={() => openFile?.(artifact.path, getFileName(artifact.path))}
                className="w-full rounded-sm border border-border/70 px-2 py-1 text-left hover:bg-background-interactive"
              >
                <div className="truncate text-xs font-medium">{getFileName(artifact.path)}</div>
                <div className="truncate text-[10px] text-muted-foreground">
                  {artifact.actionLabel}: {artifact.path}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* File tree or empty state */}
      {workspaceFiles.length === 0 ? (
        <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-8 px-4 flex-1">
          <FolderTree className="size-8 mb-2 opacity-50" />
          <span>No workspace files</span>
          <span className="text-xs mt-1">
            {workspacePath
              ? `Linked to ${workspacePath.split("/").pop()}`
              : 'Click "Link" to set a sync folder'}
          </span>
        </div>
      ) : (
        <div className="py-1 overflow-auto flex-1">
          <FileTree files={workspaceFiles} />
        </div>
      )}
    </div>
  )
}

// ============ File Tree Components ============

interface FileInfo {
  path: string
  is_dir?: boolean
  size?: number
  modified_at?: string
}

interface TreeNode {
  name: string
  path: string
  is_dir: boolean
  size?: number
  children: TreeNode[]
}

function buildFileTree(files: FileInfo[]): TreeNode[] {
  const root: TreeNode[] = []
  const nodeMap = new Map<string, TreeNode>()

  // Sort files so directories come first, then alphabetically
  const sortedFiles = [...files].sort((a, b) => {
    const aIsDir = a.is_dir ?? false
    const bIsDir = b.is_dir ?? false
    if (aIsDir && !bIsDir) return -1
    if (!aIsDir && bIsDir) return 1
    return a.path.localeCompare(b.path)
  })

  for (const file of sortedFiles) {
    // Normalize path - remove leading slash
    const normalizedPath = file.path.startsWith("/") ? file.path.slice(1) : file.path
    const parts = normalizedPath.split("/")
    const fileName = parts[parts.length - 1]

    const node: TreeNode = {
      name: fileName,
      path: file.path,
      is_dir: file.is_dir ?? false,
      size: file.size,
      children: []
    }

    if (parts.length === 1) {
      // Root level item
      root.push(node)
      nodeMap.set(normalizedPath, node)
    } else {
      // Nested item - find or create parent directories
      let currentPath = ""
      let parentChildren = root

      for (let i = 0; i < parts.length - 1; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]

        let parentNode = nodeMap.get(currentPath)
        if (!parentNode) {
          // Create implicit directory node
          parentNode = {
            name: parts[i],
            path: "/" + currentPath,
            is_dir: true,
            children: []
          }
          parentChildren.push(parentNode)
          nodeMap.set(currentPath, parentNode)
        }
        parentChildren = parentNode.children
      }

      // Add node to parent
      parentChildren.push(node)
      nodeMap.set(normalizedPath, node)
    }
  }

  // Sort children of each node (dirs first, then alphabetically)
  function sortChildren(nodes: TreeNode[]): void {
    nodes.sort((a, b) => {
      if (a.is_dir && !b.is_dir) return -1
      if (!a.is_dir && b.is_dir) return 1
      return a.name.localeCompare(b.name)
    })
    nodes.forEach((n) => sortChildren(n.children))
  }
  sortChildren(root)

  return root
}

function FileTree({ files }: { files: FileInfo[] }): React.JSX.Element {
  const { currentThreadId } = useAppStore()
  const threadState = useThreadState(currentThreadId)
  const openFile = threadState?.openFile
  const tree = useMemo(() => buildFileTree(files), [files])
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  const toggleExpand = useCallback((path: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }, [])

  return (
    <div className="select-none">
      {tree.map((node) => (
        <FileTreeNode
          key={node.path}
          node={node}
          depth={0}
          expanded={expanded}
          onToggle={toggleExpand}
          openFile={openFile}
        />
      ))}
    </div>
  )
}

const FileTreeNode = memo(
  function FileTreeNode({
    node,
    depth,
    expanded,
    onToggle,
    openFile
  }: {
    node: TreeNode
    depth: number
    expanded: Set<string>
    onToggle: (path: string) => void
    openFile?: (path: string, name: string) => void
  }): React.JSX.Element {
    const isExpanded = expanded.has(node.path)
    const hasChildren = node.children.length > 0
    const paddingLeft = 8 + depth * 16

    const handleClick = (): void => {
      if (node.is_dir) {
        onToggle(node.path)
      } else if (openFile) {
        // Open file in a new tab
        openFile(node.path, node.name)
      }
    }

    return (
      <>
        <div
          onClick={handleClick}
          className={cn(
            "flex items-center gap-1.5 py-1 pr-3 text-xs hover:bg-background-interactive cursor-pointer"
          )}
          style={{ paddingLeft }}
        >
          {/* Expand/collapse chevron for directories */}
          {node.is_dir ? (
            <span className="w-3.5 flex items-center justify-center shrink-0">
              {hasChildren &&
                (isExpanded ? (
                  <ChevronDown className="size-3 text-muted-foreground" />
                ) : (
                  <ChevronRight className="size-3 text-muted-foreground" />
                ))}
            </span>
          ) : (
            <span className="w-3.5 shrink-0" />
          )}

          {/* Icon */}
          <FileIcon name={node.name} isDir={node.is_dir} isOpen={isExpanded} />

          {/* Name */}
          <span className="truncate flex-1">{node.name}</span>

          {/* Size for files */}
          {!node.is_dir && node.size !== undefined && (
            <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
              {formatSize(node.size)}
            </span>
          )}
        </div>

        {/* Children */}
        {node.is_dir &&
          isExpanded &&
          node.children.map((child) => (
            <FileTreeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              expanded={expanded}
              onToggle={onToggle}
              openFile={openFile}
            />
          ))}
      </>
    )
  },
  (prevProps, nextProps) => {
    // Only re-render if:
    // 1. The node itself changed
    // 2. The expansion state of THIS node changed
    // 3. The openFile callback changed
    // 4. The onToggle callback changed
    return (
      prevProps.node === nextProps.node &&
      prevProps.expanded.has(prevProps.node.path) === nextProps.expanded.has(nextProps.node.path) &&
      prevProps.openFile === nextProps.openFile &&
      prevProps.onToggle === nextProps.onToggle &&
      prevProps.depth === nextProps.depth
    )
  }
)

function FileIcon({
  name,
  isDir,
  isOpen
}: {
  name: string
  isDir: boolean
  isOpen?: boolean
}): React.JSX.Element {
  if (isDir) {
    return isOpen ? (
      <FolderOpen className="size-3.5 text-amber-500 shrink-0" />
    ) : (
      <Folder className="size-3.5 text-amber-500 shrink-0" />
    )
  }

  // Get file extension
  const ext = name.includes(".") ? name.split(".").pop()?.toLowerCase() : ""

  // Map extensions to icons and colors
  switch (ext) {
    case "ts":
    case "tsx":
      return <FileCode className="size-3.5 text-blue-400 shrink-0" />
    case "js":
    case "jsx":
      return <FileCode className="size-3.5 text-yellow-400 shrink-0" />
    case "json":
      return <FileJson className="size-3.5 text-yellow-600 shrink-0" />
    case "md":
    case "mdx":
      return <FileText className="size-3.5 text-muted-foreground shrink-0" />
    case "py":
      return <FileCode className="size-3.5 text-green-400 shrink-0" />
    case "css":
    case "scss":
    case "sass":
      return <FileCode className="size-3.5 text-pink-400 shrink-0" />
    case "html":
      return <FileCode className="size-3.5 text-orange-400 shrink-0" />
    case "svg":
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "webp":
      return <Image className="size-3.5 text-purple-400 shrink-0" />
    case "yml":
    case "yaml":
      return <FileType className="size-3.5 text-red-400 shrink-0" />
    default:
      return <File className="size-3.5 text-muted-foreground shrink-0" />
  }
}

type TimelineEntryKind =
  | "user"
  | "assistant"
  | "tool_call"
  | "tool_result"
  | "subagent_started"
  | "subagent_completed"
  | "subagent_failed"
  | "error"
  | "approval"

interface TimelineEntry {
  id: string
  kind: TimelineEntryKind
  label: string
  detail?: string
  meta?: string[]
  timestamp: number
  eventType: TimelineEvent["eventType"] | "approval_virtual"
  toolName?: string
  templateId?: string
  runThreadId?: string
  zeroClawDeploymentId?: string
}

type TimelineFilterMode = "all" | "trigger_matches"

function truncateSummary(value: string, maxLength: number = 140): string {
  if (value.length <= maxLength) {
    return value
  }
  return `${value.slice(0, maxLength - 3)}...`
}

function summarizeToolCallArgs(name: string, args: Record<string, unknown> | undefined): string {
  const safeArgs = args || {}
  if (name === "write_file" || name === "edit_file" || name === "read_file") {
    const filePath = safeArgs.file_path
    if (typeof filePath === "string" && filePath.trim().length > 0) {
      return filePath
    }
  }

  if (name === "execute") {
    const command = safeArgs.command
    if (typeof command === "string" && command.trim().length > 0) {
      return command
    }
  }

  if (name === "task") {
    const subagentType = safeArgs.subagent_type
    const description = safeArgs.description
    const left = typeof subagentType === "string" ? subagentType : "subagent"
    const right = typeof description === "string" ? truncateSummary(description, 120) : ""
    return right ? `${left}: ${right}` : left
  }

  try {
    return truncateSummary(JSON.stringify(safeArgs), 120)
  } catch {
    return ""
  }
}

function readPayloadString(
  payload: Record<string, unknown> | undefined,
  key: string
): string | undefined {
  if (!payload) {
    return undefined
  }
  const value = payload[key]
  if (typeof value !== "string") {
    return undefined
  }
  const normalized = value.trim()
  return normalized.length > 0 ? normalized : undefined
}

function extractTemplatePayload(event: TimelineEvent): {
  templateId?: string
  runThreadId?: string
} {
  const templateId = readPayloadString(event.payload, "templateId")
  const runThreadId = readPayloadString(event.payload, "threadId")
  return {
    templateId,
    runThreadId
  }
}

function extractZeroClawPayload(event: TimelineEvent): {
  deploymentId?: string
} {
  const deploymentId = readPayloadString(event.payload, "deploymentId")
  return {
    deploymentId
  }
}

function extractApprovalDecisionPayload(event: TimelineEvent): {
  decision?: "approve" | "reject" | "edit"
  toolName?: string
  toolCallId?: string
} {
  const rawDecision = readPayloadString(event.payload, "approvalDecision")
  const decision =
    rawDecision === "approve" || rawDecision === "reject" || rawDecision === "edit"
      ? rawDecision
      : undefined
  const toolName = readPayloadString(event.payload, "toolName")
  const toolCallId = readPayloadString(event.payload, "toolCallId")
  return {
    decision,
    toolName,
    toolCallId
  }
}

function buildTriggerMatchMeta(event: TimelineEvent): string[] {
  const triggerType = readPayloadString(event.payload, "triggerType")
  const triggerEventKey = readPayloadString(event.payload, "triggerEventKey")
  const triggerSourceKey = readPayloadString(event.payload, "triggerSourceKey")
  const triggerMode = readPayloadString(event.payload, "triggerExecutionMode")
  const status = readPayloadString(event.payload, "status")
  const sourceEventType = readPayloadString(event.payload, "sourceEventType")
  const sourceToolName = readPayloadString(event.payload, "sourceToolName")

  return [
    triggerType ? `type:${triggerType}` : undefined,
    triggerEventKey ? `event:${triggerEventKey}` : undefined,
    triggerSourceKey ? `source:${triggerSourceKey}` : undefined,
    triggerMode ? `mode:${triggerMode}` : undefined,
    sourceEventType ? `from:${sourceEventType}` : undefined,
    sourceToolName ? `tool:${sourceToolName}` : undefined,
    status ? `status:${status}` : undefined
  ].filter((value): value is string => !!value)
}

function normalizeTimestamp(value: Date | string | number | undefined, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value
  }
  if (value instanceof Date) {
    return value.getTime()
  }
  if (typeof value === "string") {
    const parsed = Date.parse(value)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }
  return fallback
}

function formatTimelineTime(timestamp: number): string {
  if (!Number.isFinite(timestamp) || timestamp <= 0) {
    return "--:--"
  }
  return new Date(timestamp).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  })
}

function getTimelineEntryVisual(kind: TimelineEntryKind): {
  icon: React.ElementType
  colorClass: string
} {
  switch (kind) {
    case "user":
      return { icon: UserRound, colorClass: "text-muted-foreground" }
    case "assistant":
      return { icon: MessageSquare, colorClass: "text-status-info" }
    case "tool_call":
      return { icon: Wrench, colorClass: "text-status-warning" }
    case "tool_result":
      return { icon: CheckCircle2, colorClass: "text-status-nominal" }
    case "subagent_started":
      return { icon: GitBranch, colorClass: "text-status-info" }
    case "subagent_completed":
      return { icon: CheckCircle2, colorClass: "text-status-nominal" }
    case "subagent_failed":
      return { icon: XCircle, colorClass: "text-status-critical" }
    case "error":
      return { icon: XCircle, colorClass: "text-status-critical" }
    case "approval":
      return { icon: ShieldAlert, colorClass: "text-status-warning" }
    default:
      return { icon: Circle, colorClass: "text-muted-foreground" }
  }
}

function toTimelineEntry(event: TimelineEvent): TimelineEntry {
  const timestamp = normalizeTimestamp(event.occurredAt, Date.now())
  const summary = event.summary ? truncateSummary(event.summary) : undefined
  const toolName = event.toolName || "tool"
  const templatePayload = extractTemplatePayload(event)
  const zeroClawPayload = extractZeroClawPayload(event)
  const approvalPayload = extractApprovalDecisionPayload(event)

  switch (event.eventType) {
    case "user_message":
      return {
        id: event.id,
        kind: "user",
        label: "User request",
        detail: summary,
        timestamp,
        eventType: event.eventType
      }
    case "tool_call":
      if (toolName === "template:schedule") {
        return {
          id: event.id,
          kind: "assistant",
          label: "Scheduled run claimed",
          detail: summary,
          timestamp,
          eventType: event.eventType,
          toolName,
          templateId: templatePayload.templateId
        }
      }
      if (toolName === "template:run") {
        return {
          id: event.id,
          kind: "assistant",
          label: "Template run started",
          detail: summary,
          timestamp,
          eventType: event.eventType,
          toolName,
          templateId: templatePayload.templateId
        }
      }
      if (toolName === "template:auto_run") {
        return {
          id: event.id,
          kind: "assistant",
          label: "Template auto-run requested",
          detail: summary,
          timestamp,
          eventType: event.eventType,
          toolName,
          templateId: templatePayload.templateId
        }
      }
      return {
        id: event.id,
        kind: "tool_call",
        label: `Tool call: ${toolName}`,
        detail: summary,
        timestamp,
        eventType: event.eventType,
        toolName
      }
    case "tool_result":
      if (approvalPayload.decision) {
        const labelAction =
          approvalPayload.decision === "approve"
            ? "approved"
            : approvalPayload.decision === "reject"
              ? "rejected"
              : "edited"
        const resolvedToolName = approvalPayload.toolName || toolName
        const callSuffix = approvalPayload.toolCallId
          ? ` (${approvalPayload.toolCallId.slice(0, 8)})`
          : ""
        return {
          id: event.id,
          kind: "approval",
          label: `Approval ${labelAction}: ${resolvedToolName}${callSuffix}`,
          detail: summary,
          timestamp,
          eventType: event.eventType,
          toolName
        }
      }
      if (toolName === "zeroclaw:webhook") {
        return {
          id: event.id,
          kind: "assistant",
          label: "ZeroClaw invocation",
          detail: summary,
          timestamp,
          eventType: event.eventType,
          toolName,
          zeroClawDeploymentId: zeroClawPayload.deploymentId
        }
      }
      if (toolName === "template:schedule") {
        return {
          id: event.id,
          kind: "assistant",
          label: "Scheduled run update",
          detail: summary,
          timestamp,
          eventType: event.eventType,
          toolName,
          templateId: templatePayload.templateId,
          runThreadId: templatePayload.runThreadId
        }
      }
      if (toolName === "template:run") {
        return {
          id: event.id,
          kind: "assistant",
          label: "Template run initialized",
          detail: summary,
          timestamp,
          eventType: event.eventType,
          toolName,
          templateId: templatePayload.templateId
        }
      }
      if (toolName === "template:auto_run") {
        return {
          id: event.id,
          kind: "assistant",
          label: "Template auto-run update",
          detail: summary,
          timestamp,
          eventType: event.eventType,
          toolName,
          templateId: templatePayload.templateId,
          runThreadId: templatePayload.runThreadId
        }
      }
      return {
        id: event.id,
        kind: "tool_result",
        label: `Tool result: ${toolName}`,
        detail: summary,
        timestamp,
        eventType: event.eventType,
        toolName
      }
    case "approval_required":
      return {
        id: event.id,
        kind: "approval",
        label: `Approval required: ${toolName}`,
        detail: summary,
        timestamp,
        eventType: event.eventType,
        toolName
      }
    case "subagent_started":
      return {
        id: event.id,
        kind: "subagent_started",
        label: "Delegated task",
        detail: summary,
        timestamp,
        eventType: event.eventType,
        toolName
      }
    case "subagent_completed":
      return {
        id: event.id,
        kind: "subagent_completed",
        label: "Subagent completed",
        detail: summary,
        timestamp,
        eventType: event.eventType,
        toolName
      }
    case "template_trigger_match":
      return {
        id: event.id,
        kind: "assistant",
        label: "Template trigger matched",
        detail: summary,
        meta: buildTriggerMatchMeta(event),
        timestamp,
        eventType: event.eventType,
        toolName,
        templateId: templatePayload.templateId
      }
    case "error":
      if (toolName === "zeroclaw:webhook") {
        return {
          id: event.id,
          kind: "error",
          label: "ZeroClaw invocation error",
          detail: summary,
          timestamp,
          eventType: event.eventType,
          toolName,
          zeroClawDeploymentId: zeroClawPayload.deploymentId
        }
      }
      return {
        id: event.id,
        kind: "error",
        label: "Runtime error",
        detail: summary,
        timestamp,
        eventType: event.eventType,
        toolName
      }
    default:
      return {
        id: event.id,
        kind: "assistant",
        label: "Event",
        detail: summary,
        timestamp,
        eventType: event.eventType,
        toolName
      }
  }
}

function TimelineContent(): React.JSX.Element {
  const { currentThreadId, loadThreads, selectThread, setShowTemplatesView, setShowZeroClawView } =
    useAppStore()
  const threadState = useThreadState(currentThreadId)
  const pendingApproval = threadState?.pendingApproval ?? null
  const [events, setEvents] = useState<TimelineEvent[]>([])
  const [filterMode, setFilterMode] = useState<TimelineFilterMode>("all")

  useEffect(() => {
    if (!currentThreadId) {
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const load = async () => {
      try {
        const next = await window.api.timeline.list(currentThreadId, 400)
        if (!cancelled) {
          setEvents(next)
        }
      } catch (error) {
        console.warn("[RightPanel] Failed to load timeline events.", error)
      }
    }

    void load()
    timer = setInterval(load, 1500)

    return () => {
      cancelled = true
      if (timer) {
        clearInterval(timer)
      }
    }
  }, [currentThreadId])

  const timelineEntries = useMemo(() => {
    const entries = (currentThreadId ? events : []).map(toTimelineEntry)

    if (pendingApproval?.tool_call?.name) {
      const lastTimestamp = entries.reduce((latest, entry) => Math.max(latest, entry.timestamp), 0)
      entries.push({
        id: `pending-approval-${pendingApproval.id}`,
        kind: "approval",
        label: `Approval required: ${pendingApproval.tool_call.name}`,
        detail: summarizeToolCallArgs(
          pendingApproval.tool_call.name,
          pendingApproval.tool_call.args
        ),
        timestamp: lastTimestamp + 1,
        eventType: "approval_virtual"
      })
    }

    return entries
      .filter((entry) => Number.isFinite(entry.timestamp))
      .sort((a, b) => b.timestamp - a.timestamp)
  }, [currentThreadId, events, pendingApproval])

  const filteredEntries = useMemo(() => {
    if (filterMode === "all") {
      return timelineEntries
    }

    return timelineEntries.filter(
      (entry) =>
        entry.eventType === "template_trigger_match" || entry.toolName === "template:auto_run"
    )
  }, [filterMode, timelineEntries])

  const openTemplateInLibrary = useCallback(
    (templateId: string): void => {
      setShowTemplatesView(true, templateId)
    },
    [setShowTemplatesView]
  )

  const openRunThread = useCallback(
    async (threadId: string): Promise<void> => {
      await loadThreads()
      await selectThread(threadId)
    },
    [loadThreads, selectThread]
  )
  const openZeroClawDiagnostics = useCallback(
    (deploymentId: string): void => {
      setShowZeroClawView(true, deploymentId)
    },
    [setShowZeroClawView]
  )

  if (timelineEntries.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center text-center text-sm text-muted-foreground py-8 px-4">
        <History className="size-8 mb-2 opacity-50" />
        <span>No timeline events yet</span>
        <span className="text-xs mt-1">Tool calls, approvals, and delegation will appear here</span>
      </div>
    )
  }

  return (
    <div className="p-3">
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <Button
          size="sm"
          variant={filterMode === "all" ? "default" : "outline"}
          className="h-6 px-2 text-[10px]"
          onClick={() => setFilterMode("all")}
        >
          All
        </Button>
        <Button
          size="sm"
          variant={filterMode === "trigger_matches" ? "default" : "outline"}
          className="h-6 px-2 text-[10px]"
          onClick={() => setFilterMode("trigger_matches")}
        >
          Trigger Matches
        </Button>
      </div>

      {filteredEntries.length === 0 && (
        <div className="rounded-sm border border-border px-3 py-4 text-xs text-muted-foreground">
          No trigger-related events yet for this thread.
        </div>
      )}

      <div className="space-y-2">
        {filteredEntries.map((entry) => {
          const canOpenTemplate = !!entry.templateId
          const canOpenRunThread = !!entry.runThreadId && entry.runThreadId !== currentThreadId
          const canOpenZeroClaw = !!entry.zeroClawDeploymentId
          const visual = getTimelineEntryVisual(entry.kind)
          const Icon = visual.icon
          return (
            <div key={entry.id} className="rounded-sm border border-border p-3">
              <div className="flex items-start gap-2">
                <Icon className={cn("size-3.5 shrink-0 mt-0.5", visual.colorClass)} />
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{entry.label}</span>
                    <span className="text-[10px] text-muted-foreground tabular-nums shrink-0">
                      {formatTimelineTime(entry.timestamp)}
                    </span>
                  </div>
                  {entry.detail && (
                    <p className="mt-1 text-xs text-muted-foreground break-words">{entry.detail}</p>
                  )}
                  {entry.meta && entry.meta.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {entry.meta.map((value) => (
                        <span
                          key={`${entry.id}-${value}`}
                          className="rounded-sm border border-border/70 bg-background/60 px-1.5 py-0.5 text-[10px] text-muted-foreground"
                        >
                          {value}
                        </span>
                      ))}
                    </div>
                  )}
                  {(canOpenTemplate || canOpenRunThread || canOpenZeroClaw) && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {canOpenZeroClaw && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => {
                            if (entry.zeroClawDeploymentId) {
                              openZeroClawDiagnostics(entry.zeroClawDeploymentId)
                            }
                          }}
                        >
                          Open ZeroClaw
                        </Button>
                      )}
                      {canOpenTemplate && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => {
                            if (entry.templateId) {
                              openTemplateInLibrary(entry.templateId)
                            }
                          }}
                        >
                          Open template
                        </Button>
                      )}
                      {canOpenRunThread && (
                        <Button
                          size="sm"
                          variant="outline"
                          className="h-6 px-2 text-[10px]"
                          onClick={() => {
                            if (entry.runThreadId) {
                              void openRunThread(entry.runThreadId)
                            }
                          }}
                        >
                          Open run thread
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}
