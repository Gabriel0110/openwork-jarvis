import { useEffect, useMemo, useState } from "react"
import { useAppStore } from "@/lib/store"
import { useAllThreadStates, useAllStreamLoadingStates } from "@/lib/thread-context"
import { KanbanColumn } from "./KanbanColumn"
import { ThreadKanbanCard, SubagentKanbanCard } from "./KanbanCard"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import type { Thread, Subagent, TimelineEvent, ZeroClawDeploymentState } from "@/types"

type KanbanStatus = "pending" | "in_progress" | "interrupted" | "done"

interface ThreadWithStatus {
  thread: Thread
  status: KanbanStatus
}

interface SubagentWithParent {
  subagent: Subagent
  parentThread: Thread
  status: KanbanStatus
}

function getThreadKanbanStatus(
  thread: Thread,
  isLoading: boolean,
  hasDraft: boolean,
  hasPendingApproval: boolean
): KanbanStatus {
  if (hasPendingApproval || thread.status === "interrupted") return "interrupted"
  if (thread.status === "busy" || isLoading) return "in_progress"
  if (hasDraft) return "pending"
  return "done"
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

export function KanbanView(): React.JSX.Element {
  const {
    threads,
    selectThread,
    showSubagentsInKanban,
    createThread,
    agents,
    setShowAgentsView,
    setShowConnectorsView,
    setShowMemoryView,
    setShowTemplatesView,
    setShowToolsView,
    setShowPromptsView,
    setShowZeroClawView
  } = useAppStore()
  const allThreadStates = useAllThreadStates()
  const loadingStates = useAllStreamLoadingStates()
  const [scheduledTemplateCount, setScheduledTemplateCount] = useState(0)
  const [pausedScheduleTemplateCount, setPausedScheduleTemplateCount] = useState(0)
  const [workspaceTimelineEvents, setWorkspaceTimelineEvents] = useState<TimelineEvent[]>([])
  const [workspaceActivityHealthy, setWorkspaceActivityHealthy] = useState(true)
  const [configuredProviderCount, setConfiguredProviderCount] = useState(0)
  const [zeroClawDeployments, setZeroClawDeployments] = useState<ZeroClawDeploymentState[]>([])
  const [promptBootstrapSuggestion, setPromptBootstrapSuggestion] = useState<{
    shouldSuggest: boolean
    reason: string
    workspaceRoot?: string
  } | null>(null)
  const [currentTimeMs, setCurrentTimeMs] = useState(() => Date.now())
  const workspaceId = useMemo(() => agents[0]?.workspaceId || "default-workspace", [agents])

  useEffect(() => {
    let cancelled = false
    const loadTemplateStats = async (): Promise<void> => {
      try {
        const templates = await window.api.templates.list()
        if (cancelled) return
        let enabledCount = 0
        let pausedCount = 0
        for (const template of templates) {
          if (template.schedule?.enabled) enabledCount += 1
          else if (template.schedule?.rrule) pausedCount += 1
        }
        setScheduledTemplateCount(enabledCount)
        setPausedScheduleTemplateCount(pausedCount)
      } catch (error) {
        console.warn("[Kanban] Failed to load template stats.", error)
      }
    }
    void loadTemplateStats()
    const timer = setInterval(() => void loadTemplateStats(), 20_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  useEffect(() => {
    const timer = setInterval(() => setCurrentTimeMs(Date.now()), 60_000)
    return () => clearInterval(timer)
  }, [])

  useEffect(() => {
    let cancelled = false
    const loadWorkspaceActivity = async (): Promise<void> => {
      try {
        const events = await window.api.timeline.listWorkspace(workspaceId, 250)
        if (cancelled) return
        setWorkspaceTimelineEvents(events)
        setWorkspaceActivityHealthy(true)
      } catch (error) {
        console.warn("[Kanban] Failed to load workspace timeline events.", error)
        if (!cancelled) setWorkspaceActivityHealthy(false)
      }
    }
    void loadWorkspaceActivity()
    const timer = setInterval(() => void loadWorkspaceActivity(), 12_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [workspaceId])

  useEffect(() => {
    let cancelled = false
    const checkBootstrap = async (): Promise<void> => {
      try {
        const result = await window.api.prompts.checkBootstrap({ workspaceId })
        if (!cancelled) {
          setPromptBootstrapSuggestion({
            shouldSuggest: result.shouldSuggest,
            reason: result.reason,
            workspaceRoot: result.workspaceRoot
          })
        }
      } catch (error) {
        console.warn("[Kanban] Failed to check prompt bootstrap state.", error)
      }
    }
    void checkBootstrap()
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  useEffect(() => {
    let cancelled = false
    const loadZeroClawStats = async (): Promise<void> => {
      try {
        const deployments = await window.api.zeroclaw.deployment.list(workspaceId)
        if (!cancelled) setZeroClawDeployments(deployments)
      } catch (error) {
        console.warn("[Kanban] Failed to load ZeroClaw deployments.", error)
      }
    }
    void loadZeroClawStats()
    const timer = setInterval(() => void loadZeroClawStats(), 12_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [workspaceId])

  useEffect(() => {
    let cancelled = false
    const loadProviderStatus = async (): Promise<void> => {
      try {
        const providers = await window.api.models.listProviders()
        if (!cancelled) setConfiguredProviderCount(providers.filter((p) => p.hasApiKey).length)
      } catch (error) {
        console.warn("[Kanban] Failed to load provider status.", error)
      }
    }
    void loadProviderStatus()
    const timer = setInterval(() => void loadProviderStatus(), 45_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [])

  const handleCardClick = (threadId: string): void => {
    selectThread(threadId)
  }

  const handleNewSession = async (): Promise<void> => {
    await createThread({ title: `Thread ${new Date().toLocaleDateString()}` })
  }

  const categorizedThreads = useMemo(() => {
    const result: Record<KanbanStatus, ThreadWithStatus[]> = {
      pending: [],
      in_progress: [],
      interrupted: [],
      done: []
    }
    for (const thread of threads) {
      const isLoading = loadingStates[thread.thread_id] ?? false
      const threadState = allThreadStates[thread.thread_id]
      const hasDraft = Boolean(threadState?.draftInput?.trim())
      const hasPendingApproval = Boolean(threadState?.pendingApproval)
      const status = getThreadKanbanStatus(thread, isLoading, hasDraft, hasPendingApproval)
      result[status].push({ thread, status })
    }
    return result
  }, [threads, loadingStates, allThreadStates])

  const categorizedSubagents = useMemo(() => {
    if (!showSubagentsInKanban) {
      return { pending: [], in_progress: [], interrupted: [], done: [] }
    }
    const result: Record<KanbanStatus, SubagentWithParent[]> = {
      pending: [],
      in_progress: [],
      interrupted: [],
      done: []
    }
    const threadMap = new Map(threads.map((t) => [t.thread_id, t]))
    for (const [threadId, state] of Object.entries(allThreadStates)) {
      const parentThread = threadMap.get(threadId)
      if (!parentThread || !state.subagents) continue
      for (const subagent of state.subagents) {
        let status: KanbanStatus
        switch (subagent.status) {
          case "pending":
            status = "pending"
            break
          case "running":
            status = "in_progress"
            break
          case "completed":
          case "failed":
            status = "done"
            break
          default:
            status = "pending"
        }
        result[status].push({ subagent, parentThread, status })
      }
    }
    return result
  }, [threads, allThreadStates, showSubagentsInKanban])

  const columnData: { status: KanbanStatus; title: string }[] = [
    { status: "pending", title: "PENDING" },
    { status: "in_progress", title: "IN PROGRESS" },
    { status: "interrupted", title: "BLOCKED" },
    { status: "done", title: "DONE" }
  ]

  const pendingApprovalsCount = useMemo(
    () => Object.values(allThreadStates).filter((state) => Boolean(state?.pendingApproval)).length,
    [allThreadStates]
  )

  const recentThreads = useMemo(() => {
    return [...threads]
      .sort(
        (left, right) => new Date(right.updated_at).getTime() - new Date(left.updated_at).getTime()
      )
      .slice(0, 4)
  }, [threads])

  const recentActivity = useMemo(() => {
    return [...workspaceTimelineEvents]
      .sort((left, right) => toEventTimestamp(right.occurredAt) - toEventTimestamp(left.occurredAt))
      .slice(0, 8)
  }, [workspaceTimelineEvents])

  const diskChangesLast24h = useMemo(() => {
    const cutoff = currentTimeMs - 24 * 60 * 60 * 1000
    return workspaceTimelineEvents.filter((event) => {
      const timestamp = toEventTimestamp(event.occurredAt)
      const toolName = (event.toolName || "").toLowerCase()
      return (
        timestamp >= cutoff &&
        event.eventType === "tool_call" &&
        (toolName === "write_file" || toolName === "edit_file")
      )
    }).length
  }, [currentTimeMs, workspaceTimelineEvents])

  const lastSchedulerHeartbeatMs = useMemo(() => {
    const matching = workspaceTimelineEvents
      .filter((event) => (event.toolName || "").toLowerCase() === "template:schedule")
      .map((event) => toEventTimestamp(event.occurredAt))
      .filter((timestamp) => timestamp > 0)
    return matching.length === 0 ? null : Math.max(...matching)
  }, [workspaceTimelineEvents])

  const schedulerHealthy = useMemo(() => {
    if (scheduledTemplateCount === 0) return true
    if (!lastSchedulerHeartbeatMs) return false
    return currentTimeMs - lastSchedulerHeartbeatMs <= 10 * 60 * 1000
  }, [currentTimeMs, lastSchedulerHeartbeatMs, scheduledTemplateCount])

  const zeroClawRunningCount = useMemo(
    () =>
      zeroClawDeployments.filter((d) => d.status === "running" || d.status === "starting").length,
    [zeroClawDeployments]
  )

  const zeroClawErrorCount = useMemo(
    () => zeroClawDeployments.filter((d) => d.status === "error").length,
    [zeroClawDeployments]
  )

  return (
    <section className="flex h-full flex-col overflow-hidden bg-background">
      <div className="flex-1 overflow-auto">
        <div className="space-y-3 px-8 py-6 pb-0">
          {promptBootstrapSuggestion?.shouldSuggest && (
            <div className="rounded-md border border-border bg-background p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Workspace Bootstrap
              </div>
              <div className="mt-2 text-sm">
                No `AGENTS.md` found for this workspace. Apply one from your prompt library.
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {promptBootstrapSuggestion.workspaceRoot || promptBootstrapSuggestion.reason}
              </div>
              <Button
                size="sm"
                className="mt-3"
                onClick={() => setShowPromptsView(true, { agentsOnly: true })}
              >
                Open Prompt Library
              </Button>
            </div>
          )}

          {/* Status blocks row */}
          <div className="grid gap-3 md:grid-cols-6">
            {/* New Session */}
            <div className="rounded-md border border-border bg-background p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                New Session
              </div>
              <p className="mt-2 text-sm text-muted-foreground">Start a fresh orchestrator run.</p>
              <Button size="sm" className="mt-3" onClick={() => void handleNewSession()}>
                New session
              </Button>
            </div>

            {/* Pending Approvals */}
            <div className="rounded-md border border-border bg-background p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Pending Approvals
              </div>
              <div className="mt-2 text-3xl font-semibold tabular-nums">
                {pendingApprovalsCount}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                Human approval gates currently waiting.
              </p>
            </div>

            {/* Agent Status */}
            <div className="rounded-md border border-border bg-background p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Agent Status
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-3xl font-semibold tabular-nums">{agents.length}</span>
                <Badge variant="outline">Registered</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {threads.filter((t) => t.status === "busy").length} active sessions.
              </p>
            </div>

            {/* Scheduled Runs */}
            <div className="rounded-md border border-border bg-background p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Scheduled Runs
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-3xl font-semibold tabular-nums">
                  {scheduledTemplateCount}
                </span>
                <Badge variant="info">Enabled</Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {pausedScheduleTemplateCount} templates have paused schedules.
              </p>
            </div>

            {/* System Health */}
            <div className="rounded-md border border-border bg-background p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                System Health
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <Badge variant={workspaceActivityHealthy ? "nominal" : "warning"}>
                  {workspaceActivityHealthy ? "Runtime OK" : "Runtime Degraded"}
                </Badge>
                <Badge variant={schedulerHealthy ? "nominal" : "warning"}>
                  {schedulerHealthy ? "Scheduler OK" : "Scheduler Stale"}
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {configuredProviderCount} provider keys configured.
              </p>
            </div>

            {/* ZeroClaw Runtime */}
            <div className="rounded-md border border-border bg-background p-4">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                ZeroClaw Runtime
              </div>
              <div className="mt-2 flex items-center gap-2">
                <span className="text-3xl font-semibold tabular-nums">{zeroClawRunningCount}</span>
                <Badge variant={zeroClawErrorCount > 0 ? "warning" : "nominal"}>
                  {zeroClawDeployments.length} deployed
                </Badge>
              </div>
              <p className="mt-2 text-xs text-muted-foreground">
                {zeroClawErrorCount} deployment error{zeroClawErrorCount === 1 ? "" : "s"}.
              </p>
            </div>
          </div>

          {/* Command Cards */}
          <div className="rounded-md border border-border bg-background p-4">
            <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
              Command Cards
            </div>
            <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-7">
              <button
                onClick={() => setShowTemplatesView(true)}
                className="rounded-md border border-border bg-sidebar px-4 py-3 text-left transition-colors hover:bg-background-interactive"
              >
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Templates
                </div>
                <div className="mt-1 text-sm">Run Workflow</div>
              </button>
              <button
                onClick={() => setShowAgentsView(true)}
                className="rounded-md border border-border bg-sidebar px-4 py-3 text-left transition-colors hover:bg-background-interactive"
              >
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Agents
                </div>
                <div className="mt-1 text-sm">Command Roster</div>
              </button>
              <button
                onClick={() => setShowConnectorsView(true)}
                className="rounded-md border border-border bg-sidebar px-4 py-3 text-left transition-colors hover:bg-background-interactive"
              >
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Connectors
                </div>
                <div className="mt-1 text-sm">Ops Console</div>
              </button>
              <button
                onClick={() => setShowToolsView(true)}
                className="rounded-md border border-border bg-sidebar px-4 py-3 text-left transition-colors hover:bg-background-interactive"
              >
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Skills
                </div>
                <div className="mt-1 text-sm">Tool Matrix</div>
              </button>
              <button
                onClick={() => setShowPromptsView(true)}
                className="rounded-md border border-border bg-sidebar px-4 py-3 text-left transition-colors hover:bg-background-interactive"
              >
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Prompts
                </div>
                <div className="mt-1 text-sm">Prompt Library</div>
              </button>
              <button
                onClick={() => setShowMemoryView(true)}
                className="rounded-md border border-border bg-sidebar px-4 py-3 text-left transition-colors hover:bg-background-interactive"
              >
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  Memory
                </div>
                <div className="mt-1 text-sm">Knowledge Vault</div>
              </button>
              <button
                onClick={() => setShowZeroClawView(true)}
                className="rounded-md border border-border bg-sidebar px-4 py-3 text-left transition-colors hover:bg-background-interactive"
              >
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                  ZeroClaw
                </div>
                <div className="mt-1 text-sm">Deployment Ops</div>
              </button>
            </div>
          </div>

          {/* Kanban board */}
          <div className="rounded-md border border-border bg-background p-3">
            <div className="flex min-w-max gap-3 overflow-x-auto">
              {columnData.map(({ status, title }) => {
                const threadItems = categorizedThreads[status]
                const subagentItems = categorizedSubagents[status]
                const totalCount = threadItems.length + subagentItems.length

                return (
                  <KanbanColumn key={status} title={title} status={status} count={totalCount}>
                    {threadItems.map(({ thread, status: threadStatus }) => (
                      <ThreadKanbanCard
                        key={thread.thread_id}
                        thread={thread}
                        status={threadStatus}
                        onClick={() => handleCardClick(thread.thread_id)}
                      />
                    ))}
                    {subagentItems.map(({ subagent, parentThread }) => (
                      <SubagentKanbanCard
                        key={subagent.id}
                        subagent={subagent}
                        parentThread={parentThread}
                        onClick={() => handleCardClick(parentThread.thread_id)}
                      />
                    ))}
                    {totalCount === 0 && (
                      <div className="py-8 text-center text-sm text-muted-foreground">No items</div>
                    )}
                  </KanbanColumn>
                )
              })}
            </div>
          </div>

          {/* Recent Sessions */}
          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Recent Sessions
              </div>
              <div className="text-xs text-muted-foreground">
                Disk changes (24h): {diskChangesLast24h}
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {recentThreads.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No sessions yet.</p>
              ) : (
                recentThreads.map((thread) => (
                  <button
                    key={thread.thread_id}
                    onClick={() => handleCardClick(thread.thread_id)}
                    className="w-full rounded-md border border-border px-3 py-2 text-left text-sm transition-colors hover:bg-background-interactive"
                  >
                    <div className="truncate font-medium">
                      {thread.title || thread.thread_id.slice(0, 16)}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground">
                      Updated {new Date(thread.updated_at).toLocaleTimeString()}
                    </div>
                  </button>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Agent Activity Feed */}
        <div className="px-8 pb-6">
          <div className="rounded-md border border-border bg-background p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                Agent Activity Feed
              </div>
              <div className="text-xs text-muted-foreground">
                {workspaceTimelineEvents.length} events
              </div>
            </div>
            <div className="mt-3 space-y-2">
              {recentActivity.length === 0 ? (
                <p className="py-2 text-sm text-muted-foreground">No timeline activity yet.</p>
              ) : (
                recentActivity.map((event) => (
                  <div
                    key={event.id}
                    className="rounded-md border border-border px-3 py-2 text-sm text-muted-foreground"
                  >
                    <div className="truncate">
                      {(event.summary || `${event.eventType} ${event.toolName || ""}`).trim()}
                    </div>
                    <div className="mt-0.5 text-xs text-muted-foreground/70">
                      {new Date(toEventTimestamp(event.occurredAt)).toLocaleString()}
                    </div>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}
