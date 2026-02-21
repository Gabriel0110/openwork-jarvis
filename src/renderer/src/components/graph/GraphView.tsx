import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { Bot, Link2, Network, Play, RotateCcw, UserRound } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useAppStore } from "@/lib/store"
import { useThreadState } from "@/lib/thread-context"
import { cn } from "@/lib/utils"
import type { AgentDefinition, Subagent, TimelineEvent } from "@/types"

interface GraphNode {
  id: string
  x: number
  y: number
  agent: AgentDefinition
  isOrchestrator: boolean
}

type GraphEdgeType = "delegation" | "tools" | "memory"

interface GraphEdge {
  id: string
  sourceId: string
  targetId: string
  type: GraphEdgeType
  label: string
}

type WorkspaceGraphLayout = Record<string, { x: number; y: number }>
type DelegationPlaybackStatus = "pending" | "running" | "completed" | "failed"

const NODE_POSITION_MIN = 8
const NODE_POSITION_MAX = 92

function clampPosition(value: number): number {
  return Math.max(NODE_POSITION_MIN, Math.min(NODE_POSITION_MAX, value))
}

function intersectCount(left: string[], right: string[]): number {
  if (left.length === 0 || right.length === 0) {
    return 0
  }
  const rightSet = new Set(right)
  return left.filter((entry) => rightSet.has(entry)).length
}

function buildGraphNodes(agents: AgentDefinition[]): GraphNode[] {
  const orchestrator = agents.find((agent) => agent.isOrchestrator)
  const specialists = agents.filter((agent) => !agent.isOrchestrator)

  const nodes: GraphNode[] = []
  if (orchestrator) {
    nodes.push({
      id: orchestrator.id,
      x: 50,
      y: 45,
      agent: orchestrator,
      isOrchestrator: true
    })
  }

  const ringAgents = orchestrator ? specialists : agents
  const radius = orchestrator ? 33 : 38
  const centerY = orchestrator ? 45 : 50
  const count = Math.max(ringAgents.length, 1)

  ringAgents.forEach((agent, index) => {
    const angle = (Math.PI * 2 * index) / count - Math.PI / 2
    nodes.push({
      id: agent.id,
      x: 50 + radius * Math.cos(angle),
      y: centerY + radius * Math.sin(angle),
      agent,
      isOrchestrator: false
    })
  })

  return nodes
}

function getAgentDepartment(agent: AgentDefinition): string {
  const primaryTag = (agent.tags[0] || "").trim()
  if (primaryTag.length > 0) {
    return primaryTag
  }
  return "general"
}

function buildDepartmentGroupedNodes(agents: AgentDefinition[]): GraphNode[] {
  const orchestrator = agents.find((agent) => agent.isOrchestrator)
  const specialists = agents.filter((agent) => !agent.isOrchestrator)
  const byDepartment = new Map<string, AgentDefinition[]>()

  for (const agent of specialists) {
    const department = getAgentDepartment(agent)
    const entries = byDepartment.get(department) || []
    entries.push(agent)
    byDepartment.set(department, entries)
  }

  const departments = Array.from(byDepartment.entries()).sort((left, right) =>
    left[0].localeCompare(right[0])
  )

  const nodes: GraphNode[] = []
  if (orchestrator) {
    nodes.push({
      id: orchestrator.id,
      x: 50,
      y: 16,
      agent: orchestrator,
      isOrchestrator: true
    })
  }

  if (departments.length === 0) {
    if (!orchestrator) {
      return buildGraphNodes(agents)
    }
    return nodes
  }

  departments.forEach(([, departmentAgents], departmentIndex) => {
    const departmentCount = departments.length
    const x =
      departmentCount === 1
        ? 50
        : 12 + (departmentIndex * (100 - 24)) / Math.max(1, departmentCount - 1)

    departmentAgents.forEach((agent, index) => {
      const rowCount = departmentAgents.length
      const y = rowCount === 1 ? 56 : 34 + (index * (100 - 44)) / Math.max(1, rowCount - 1)
      nodes.push({
        id: agent.id,
        x: clampPosition(x),
        y: clampPosition(y),
        agent,
        isOrchestrator: false
      })
    })
  })

  return nodes
}

function buildGraphEdges(
  agents: AgentDefinition[],
  showToolEdges: boolean,
  showMemoryEdges: boolean
): GraphEdge[] {
  const edges: GraphEdge[] = []
  const orchestrator = agents.find((agent) => agent.isOrchestrator)
  const specialists = agents.filter((agent) => !agent.isOrchestrator)

  if (orchestrator) {
    for (const specialist of specialists) {
      edges.push({
        id: `delegation-${orchestrator.id}-${specialist.id}`,
        sourceId: orchestrator.id,
        targetId: specialist.id,
        type: "delegation",
        label: "delegation"
      })
    }
  }

  for (let i = 0; i < agents.length; i += 1) {
    for (let j = i + 1; j < agents.length; j += 1) {
      const left = agents[i]
      const right = agents[j]

      if (showToolEdges) {
        const sharedTools = intersectCount(left.toolAllowlist, right.toolAllowlist)
        const sharedConnectors = intersectCount(left.connectorAllowlist, right.connectorAllowlist)
        const sharedCapabilities = sharedTools + sharedConnectors

        if (sharedCapabilities > 0) {
          edges.push({
            id: `tools-${left.id}-${right.id}`,
            sourceId: left.id,
            targetId: right.id,
            type: "tools",
            label: `shared tools (${sharedCapabilities})`
          })
        }
      }

      if (showMemoryEdges && left.memoryScope === "shared" && right.memoryScope === "shared") {
        edges.push({
          id: `memory-${left.id}-${right.id}`,
          sourceId: left.id,
          targetId: right.id,
          type: "memory",
          label: "shared memory"
        })
      }
    }
  }

  return edges
}

function normalizeKey(value: string | undefined): string {
  return (value || "").toLowerCase().replace(/[^a-z0-9]/g, "")
}

function matchSubagentToAgent(subagent: Subagent, agents: AgentDefinition[]): string | null {
  const subagentName = normalizeKey(subagent.name)
  const subagentType = normalizeKey(subagent.subagentType)

  const match = agents.find((agent) => {
    const agentKey = normalizeKey(agent.name)
    return agentKey.length > 0 && (agentKey === subagentName || agentKey === subagentType)
  })

  return match?.id || null
}

function reduceDelegationStatus(
  previous: DelegationPlaybackStatus | undefined,
  next: DelegationPlaybackStatus
): DelegationPlaybackStatus {
  const rank: Record<DelegationPlaybackStatus, number> = {
    pending: 0,
    completed: 1,
    failed: 2,
    running: 3
  }
  if (!previous) {
    return next
  }
  return rank[next] >= rank[previous] ? next : previous
}

export function GraphView(): React.JSX.Element {
  const { agents, currentThreadId, loadAgents, createThread, setShowGraphView, setShowAgentsView } =
    useAppStore()
  const threadState = useThreadState(currentThreadId)

  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null)
  const [showToolEdges, setShowToolEdges] = useState(true)
  const [showMemoryEdges, setShowMemoryEdges] = useState(true)
  const [groupByDepartment, setGroupByDepartment] = useState(false)
  const [simulationEnabled, setSimulationEnabled] = useState(false)
  const [simulationTick, setSimulationTick] = useState(0)
  const [draggingNodeId, setDraggingNodeId] = useState<string | null>(null)
  const [isOpeningChat, setIsOpeningChat] = useState(false)
  const [workspaceLayout, setWorkspaceLayout] = useState<WorkspaceGraphLayout>({})
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([])

  const graphCanvasRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    loadAgents()
  }, [loadAgents])

  const workspaceId = useMemo(() => agents[0]?.workspaceId || "default-workspace", [agents])

  useEffect(() => {
    let cancelled = false

    async function loadLayout(): Promise<void> {
      try {
        const rows = await window.api.graph.getLayout(workspaceId)
        if (cancelled) return
        const next: WorkspaceGraphLayout = {}
        for (const row of rows) {
          next[row.agentId] = { x: row.x, y: row.y }
        }
        setWorkspaceLayout(next)
      } catch (error) {
        console.warn("[GraphView] Failed to load graph layout.", error)
        if (!cancelled) {
          setWorkspaceLayout({})
        }
      }
    }

    loadLayout()
    return () => {
      cancelled = true
    }
  }, [workspaceId])

  useEffect(() => {
    if (!currentThreadId) {
      setTimelineEvents([])
      return
    }

    let cancelled = false
    let timer: ReturnType<typeof setInterval> | null = null

    const loadTimeline = async () => {
      try {
        const events = await window.api.timeline.list(currentThreadId, 400)
        if (!cancelled) {
          setTimelineEvents(events)
        }
      } catch (error) {
        console.warn("[GraphView] Failed to load timeline events.", error)
      }
    }

    loadTimeline()
    timer = setInterval(loadTimeline, 1500)

    return () => {
      cancelled = true
      if (timer) {
        clearInterval(timer)
      }
    }
  }, [currentThreadId])

  const rawGraphNodes = useMemo(
    () => (groupByDepartment ? buildDepartmentGroupedNodes(agents) : buildGraphNodes(agents)),
    [agents, groupByDepartment]
  )
  const graphNodes = useMemo(() => {
    if (groupByDepartment) {
      return rawGraphNodes
    }
    return rawGraphNodes.map((node) => {
      const saved = workspaceLayout[node.id]
      if (!saved) {
        return node
      }
      return {
        ...node,
        x: clampPosition(saved.x),
        y: clampPosition(saved.y)
      }
    })
  }, [groupByDepartment, rawGraphNodes, workspaceLayout])

  const graphEdges = useMemo(
    () => buildGraphEdges(agents, showToolEdges, showMemoryEdges),
    [agents, showMemoryEdges, showToolEdges]
  )

  useEffect(() => {
    if (!simulationEnabled || graphEdges.length === 0) {
      return
    }

    const timer = window.setInterval(() => {
      setSimulationTick((prev) => prev + 1)
    }, 700)

    return () => window.clearInterval(timer)
  }, [graphEdges.length, simulationEnabled])

  const selectedAgentIdResolved = useMemo(() => {
    if (graphNodes.length === 0) {
      return null
    }
    if (selectedAgentId && graphNodes.some((node) => node.id === selectedAgentId)) {
      return selectedAgentId
    }
    const orchestrator = graphNodes.find((node) => node.isOrchestrator)
    return orchestrator?.id || graphNodes[0].id
  }, [graphNodes, selectedAgentId])

  const runSubagents = useMemo(() => threadState?.subagents || [], [threadState?.subagents])
  const activeDelegationStatus = useMemo(() => {
    const statusMap = new Map<string, DelegationPlaybackStatus>()
    const orchestrator = agents.find((agent) => agent.isOrchestrator)
    if (!orchestrator) {
      return statusMap
    }

    for (const event of timelineEvents) {
      if (!event.targetAgentId || event.targetAgentId === orchestrator.id) {
        continue
      }
      if (event.eventType !== "subagent_started" && event.eventType !== "subagent_completed") {
        continue
      }

      const edgeId = `delegation-${orchestrator.id}-${event.targetAgentId}`
      const mappedStatus: DelegationPlaybackStatus =
        event.eventType === "subagent_started" ? "running" : "completed"
      statusMap.set(edgeId, reduceDelegationStatus(statusMap.get(edgeId), mappedStatus))
    }

    for (const subagent of runSubagents) {
      const targetAgentId = matchSubagentToAgent(subagent, agents)
      if (!targetAgentId || targetAgentId === orchestrator.id) {
        continue
      }

      const edgeId = `delegation-${orchestrator.id}-${targetAgentId}`
      let mappedStatus: DelegationPlaybackStatus = "pending"
      if (subagent.status === "running") {
        mappedStatus = "running"
      } else if (subagent.status === "completed") {
        mappedStatus = "completed"
      } else if (subagent.status === "failed") {
        mappedStatus = "failed"
      }

      statusMap.set(edgeId, reduceDelegationStatus(statusMap.get(edgeId), mappedStatus))
    }

    return statusMap
  }, [agents, runSubagents, timelineEvents])

  const simulatedEdgeId =
    simulationEnabled && graphEdges.length > 0
      ? graphEdges[simulationTick % graphEdges.length].id
      : null

  const selectedNode = graphNodes.find((node) => node.id === selectedAgentIdResolved)

  const setNodePosition = useCallback((nodeId: string, x: number, y: number) => {
    setWorkspaceLayout((previous) => ({
      ...previous,
      [nodeId]: {
        x: clampPosition(x),
        y: clampPosition(y)
      }
    }))
  }, [])

  const persistNodePosition = useCallback(
    async (nodeId: string, x: number, y: number) => {
      try {
        await window.api.graph.upsertLayout(workspaceId, nodeId, clampPosition(x), clampPosition(y))
      } catch (error) {
        console.warn("[GraphView] Failed to persist node position.", error)
      }
    },
    [workspaceId]
  )

  const clearWorkspaceLayout = useCallback(() => {
    setWorkspaceLayout({})
    window.api.graph.clearLayout(workspaceId).catch((error) => {
      console.warn("[GraphView] Failed to clear graph layout.", error)
    })
  }, [workspaceId])

  const startNodeDrag = useCallback(
    (nodeId: string, event: React.MouseEvent<HTMLButtonElement>) => {
      if (event.button !== 0) {
        return
      }
      const container = graphCanvasRef.current
      if (!container) {
        return
      }

      event.preventDefault()
      setDraggingNodeId(nodeId)
      const latestPosition = { x: 50, y: 50 }

      const updateFromClientPoint = (clientX: number, clientY: number) => {
        const rect = container.getBoundingClientRect()
        if (rect.width <= 0 || rect.height <= 0) {
          return
        }

        const x = ((clientX - rect.left) / rect.width) * 100
        const y = ((clientY - rect.top) / rect.height) * 100
        latestPosition.x = x
        latestPosition.y = y
        setNodePosition(nodeId, x, y)
      }

      updateFromClientPoint(event.clientX, event.clientY)

      const onMouseMove = (moveEvent: MouseEvent) => {
        updateFromClientPoint(moveEvent.clientX, moveEvent.clientY)
      }

      const onMouseUp = () => {
        setDraggingNodeId(null)
        void persistNodePosition(nodeId, latestPosition.x, latestPosition.y)
        window.removeEventListener("mousemove", onMouseMove)
        window.removeEventListener("mouseup", onMouseUp)
      }

      window.addEventListener("mousemove", onMouseMove)
      window.addEventListener("mouseup", onMouseUp)
    },
    [persistNodePosition, setNodePosition]
  )

  const runningDelegations = runSubagents.filter((subagent) => subagent.status === "running").length

  const openChatFromNode = useCallback(
    async (agent: AgentDefinition, asOrchestrator: boolean) => {
      setIsOpeningChat(true)
      try {
        const targetSpeakerType = asOrchestrator ? "orchestrator" : "agent"
        const targetSpeakerAgentId = asOrchestrator ? null : agent.id

        if (!currentThreadId) {
          await createThread({
            speakerType: targetSpeakerType,
            speakerAgentId: targetSpeakerAgentId
          })
        } else {
          threadState?.setSpeaker(targetSpeakerType, targetSpeakerAgentId)
        }

        setShowGraphView(false)
      } finally {
        setIsOpeningChat(false)
      }
    },
    [createThread, currentThreadId, setShowGraphView, threadState]
  )

  if (agents.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-background">
        <div className="text-center text-muted-foreground">
          <Network className="mx-auto mb-3 size-8 opacity-60" />
          <p className="text-sm">No agents available for graph view.</p>
          <p className="mt-1 text-xs">
            Create agents first, then return to run topology simulations.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full overflow-hidden bg-background">
      <div ref={graphCanvasRef} className="relative flex-1 border-r border-border">
        <div className="absolute left-3 top-3 z-20 flex items-center gap-2 rounded-sm border border-border bg-background/90 p-2 backdrop-blur">
          <Button
            variant={simulationEnabled ? "default" : "outline"}
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => {
              setSimulationTick(0)
              setSimulationEnabled((prev) => !prev)
            }}
          >
            <Play className="size-3.5" />
            {simulationEnabled ? "Running" : "Run simulation"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={clearWorkspaceLayout}
          >
            <RotateCcw className="size-3.5" />
            Reset layout
          </Button>
          <Button
            variant={groupByDepartment ? "default" : "outline"}
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setGroupByDepartment((prev) => !prev)}
          >
            <Network className="size-3.5" />
            Group by Dept
          </Button>
          <Button
            variant={showToolEdges ? "default" : "outline"}
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setShowToolEdges((prev) => !prev)}
          >
            <Link2 className="size-3.5" />
            Tools
          </Button>
          <Button
            variant={showMemoryEdges ? "default" : "outline"}
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            onClick={() => setShowMemoryEdges((prev) => !prev)}
          >
            <Network className="size-3.5" />
            Memory
          </Button>
          {runningDelegations > 0 && !simulationEnabled && (
            <Badge variant="info">{runningDelegations} live delegation</Badge>
          )}
        </div>

        <svg
          className="absolute inset-0 h-full w-full"
          viewBox="0 0 100 100"
          preserveAspectRatio="none"
        >
          {graphEdges.map((edge) => {
            const source = graphNodes.find((node) => node.id === edge.sourceId)
            const target = graphNodes.find((node) => node.id === edge.targetId)
            if (!source || !target) {
              return null
            }

            const playbackStatus = activeDelegationStatus.get(edge.id)
            const isSimulated = simulatedEdgeId === edge.id
            const isPlayback = !simulationEnabled && !!playbackStatus

            const strokeClass = (() => {
              if (isPlayback && edge.type === "delegation") {
                if (playbackStatus === "running") return "stroke-status-info"
                if (playbackStatus === "completed") return "stroke-status-nominal"
                if (playbackStatus === "failed") return "stroke-status-critical"
                return "stroke-status-warning"
              }
              if (edge.type === "delegation") return "stroke-status-info"
              if (edge.type === "tools") return "stroke-status-warning"
              return "stroke-status-nominal"
            })()

            const dashArray =
              edge.type === "delegation" ? undefined : edge.type === "tools" ? "3 2" : "1 2"
            const midX = (source.x + target.x) / 2
            const midY = (source.y + target.y) / 2
            const label = playbackStatus ? `${edge.label} • ${playbackStatus}` : edge.label

            return (
              <g key={edge.id}>
                <line
                  x1={source.x}
                  y1={source.y}
                  x2={target.x}
                  y2={target.y}
                  strokeWidth={isSimulated || isPlayback ? 0.75 : 0.35}
                  strokeDasharray={dashArray}
                  className={cn(
                    strokeClass,
                    isSimulated && "opacity-100",
                    isPlayback && "opacity-100",
                    !isSimulated && !isPlayback && "opacity-65"
                  )}
                />
                <text
                  x={midX}
                  y={midY}
                  textAnchor="middle"
                  className={cn(
                    "fill-muted-foreground text-[1.8px]",
                    (isSimulated || isPlayback) && "fill-foreground"
                  )}
                >
                  {label}
                </text>
              </g>
            )
          })}
        </svg>

        {graphNodes.map((node) => {
          const isSelected = node.id === selectedAgentIdResolved
          const isDragging = draggingNodeId === node.id

          return (
            <button
              key={node.id}
              className={cn(
                "absolute -translate-x-1/2 -translate-y-1/2 rounded-sm border px-3 py-2 text-left transition-all",
                isSelected
                  ? "border-primary bg-primary/10 shadow-lg"
                  : "border-border bg-sidebar hover:bg-sidebar-accent/60",
                isDragging && "cursor-grabbing",
                node.isOrchestrator ? "w-44" : "w-40"
              )}
              style={{ left: `${node.x}%`, top: `${node.y}%` }}
              onClick={() => setSelectedAgentId(node.id)}
              onMouseDown={(event) => {
                if (!groupByDepartment) {
                  startNodeDrag(node.id, event)
                }
              }}
            >
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider text-muted-foreground">
                {node.isOrchestrator ? (
                  <Bot className="size-3.5 text-status-info" />
                ) : (
                  <UserRound className="size-3.5 text-status-warning" />
                )}
                {node.isOrchestrator ? "Orchestrator" : "Specialist"}
              </div>
              <div className="mt-1 truncate text-sm font-medium">{node.agent.name}</div>
              <div className="mt-1 line-clamp-2 text-xs text-muted-foreground">
                {node.agent.role}
              </div>
              <div className="mt-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                {getAgentDepartment(node.agent)}
              </div>
            </button>
          )
        })}
      </div>

      <aside className="flex w-[320px] flex-col overflow-auto bg-sidebar">
        <div className="border-b border-border px-4 py-3">
          <div className="text-section-header">NODE INSPECTOR</div>
          <div className="mt-1 text-xs text-muted-foreground">
            {graphNodes.length} agents, {graphEdges.length} visible edges
          </div>
          <div className="mt-1 text-[11px] text-muted-foreground">
            Layout autosaves per workspace ({workspaceId}).
          </div>
        </div>

        {selectedNode ? (
          <div className="space-y-4 p-4">
            <div>
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold">{selectedNode.agent.name}</h3>
                {selectedNode.isOrchestrator ? <Badge variant="info">Orchestrator</Badge> : null}
                {selectedNode.agent.memoryScope === "shared" ? (
                  <Badge variant="nominal">Shared memory</Badge>
                ) : (
                  <Badge variant="outline">Private memory</Badge>
                )}
              </div>
              <p className="mt-2 text-xs text-muted-foreground">{selectedNode.agent.role}</p>
            </div>

            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Model
              </div>
              <div className="text-xs">{selectedNode.agent.modelName}</div>
            </div>

            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Tools Allowlist
              </div>
              {selectedNode.agent.toolAllowlist.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {selectedNode.agent.toolAllowlist.map((tool) => (
                    <Badge key={tool} variant="outline" className="text-[10px]">
                      {tool}
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">
                  No explicit allowlist configured.
                </div>
              )}
            </div>

            <div>
              <div className="mb-1 text-[10px] uppercase tracking-wider text-muted-foreground">
                Connectors
              </div>
              {selectedNode.agent.connectorAllowlist.length > 0 ? (
                <div className="flex flex-wrap gap-1">
                  {selectedNode.agent.connectorAllowlist.map((connector) => (
                    <Badge key={connector} variant="outline" className="text-[10px]">
                      {connector}
                    </Badge>
                  ))}
                </div>
              ) : (
                <div className="text-xs text-muted-foreground">No connectors configured.</div>
              )}
            </div>

            <Button size="sm" className="w-full" onClick={() => setShowAgentsView(true)}>
              Open Agent Configuration
            </Button>
            <Button
              size="sm"
              variant="outline"
              className="w-full"
              disabled={isOpeningChat}
              onClick={() => openChatFromNode(selectedNode.agent, selectedNode.isOrchestrator)}
            >
              {selectedNode.isOrchestrator ? "Open Orchestrator Chat" : "Open Direct Chat"}
            </Button>
          </div>
        ) : (
          <div className="p-4 text-xs text-muted-foreground">
            Select a node to inspect agent details.
          </div>
        )}
      </aside>
    </div>
  )
}
