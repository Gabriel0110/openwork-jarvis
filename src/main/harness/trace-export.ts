import { listTimelineEventsByWorkspace } from "../db/timeline-events"
import { getHarnessRun, listHarnessArtifacts, listHarnessTaskResults } from "../db/harness-runs"
import { createHarnessTraceExport, listHarnessTraceExports } from "../db/harness-traces"
import type { HarnessTraceExport, HarnessTraceExportFormat } from "../types"
import { redactHarnessPayload } from "./redaction"
import type { HarnessTraceBuildInput, HarnessTraceGraph } from "./trace-types"

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {}
}

function buildTraceGraph(input: HarnessTraceBuildInput): HarnessTraceGraph {
  const nodes: HarnessTraceGraph["nodes"] = []
  const edges: HarnessTraceGraph["edges"] = []

  const nowIso = new Date().toISOString()
  nodes.push({
    id: `run:${input.runId}`,
    type: "run",
    label: `Run ${input.runId.slice(0, 8)}`,
    timestamp: nowIso,
    data: input.runData
  })

  for (const task of input.taskResults) {
    const taskKey = String(task.taskKey || "unknown")
    const taskNodeId = `task:${taskKey}`
    nodes.push({
      id: taskNodeId,
      type: "task",
      label: String(task.taskName || taskKey),
      timestamp: String(task.updatedAt || nowIso),
      data: task
    })
    edges.push({
      id: `edge:run-task:${input.runId}:${taskKey}`,
      from: `run:${input.runId}`,
      to: taskNodeId,
      type: "contains"
    })
  }

  for (const artifact of input.artifacts) {
    const artifactNodeId = `artifact:${String(artifact.id || artifact.artifactType || "unknown")}`
    nodes.push({
      id: artifactNodeId,
      type: "artifact",
      label: String(artifact.artifactType || "artifact"),
      timestamp: String(artifact.createdAt || nowIso),
      data: artifact
    })
    edges.push({
      id: `edge:task-artifact:${String(artifact.taskKey || "unknown")}:${artifactNodeId}`,
      from: `task:${String(artifact.taskKey || "unknown")}`,
      to: artifactNodeId,
      type: "produced"
    })
  }

  for (const event of input.timelineEvents || []) {
    const eventId = String(event.id || `${event.eventType || "event"}-${Math.random()}`)
    nodes.push({
      id: `event:${eventId}`,
      type: "timeline_event",
      label: String(event.eventType || "timeline_event"),
      timestamp: String(event.occurredAt || nowIso),
      data: event
    })
    edges.push({
      id: `edge:run-event:${input.runId}:${eventId}`,
      from: `run:${input.runId}`,
      to: `event:${eventId}`,
      type: "emits"
    })
  }

  return {
    nodes,
    edges,
    events: [...(input.timelineEvents || []), ...input.taskResults, ...input.artifacts]
  }
}

function formatTraceAsJson(trace: HarnessTraceGraph): string {
  return `${JSON.stringify(trace, null, 2)}\n`
}

function formatTraceAsJsonl(trace: HarnessTraceGraph): string {
  const lines: string[] = []
  for (const node of trace.nodes) {
    lines.push(
      JSON.stringify({
        kind: "node",
        ...node
      })
    )
  }
  for (const edge of trace.edges) {
    lines.push(
      JSON.stringify({
        kind: "edge",
        ...edge
      })
    )
  }
  for (const event of trace.events) {
    lines.push(
      JSON.stringify({
        kind: "event",
        payload: event
      })
    )
  }
  return `${lines.join("\n")}\n`
}

function formatTraceAsSummary(params: {
  runId: string
  taskKey?: string
  graph: HarnessTraceGraph
  stopReasons: Record<string, number>
  failedTasks: Array<{ key: string; score: number; stopReason?: string }>
}): string {
  const topStopReasons = Object.entries(params.stopReasons)
    .sort((left, right) => right[1] - left[1])
    .slice(0, 8)
    .map(([reason, count]) => ({ reason, count }))

  return `${JSON.stringify(
    {
      runId: params.runId,
      taskKey: params.taskKey,
      nodeCount: params.graph.nodes.length,
      edgeCount: params.graph.edges.length,
      eventCount: params.graph.events.length,
      topStopReasons,
      failedTasks: params.failedTasks
    },
    null,
    2
  )}\n`
}

function materializeTraceByFormat(params: {
  runId: string
  taskKey?: string
  format: HarnessTraceExportFormat
  graph: HarnessTraceGraph
  stopReasons: Record<string, number>
  failedTasks: Array<{ key: string; score: number; stopReason?: string }>
}): {
  nodes: HarnessTraceGraph["nodes"]
  edges: HarnessTraceGraph["edges"]
  events: HarnessTraceGraph["events"]
  serialized: string
} {
  if (params.format === "summary") {
    return {
      nodes: [],
      edges: [],
      events: [],
      serialized: formatTraceAsSummary({
        runId: params.runId,
        taskKey: params.taskKey,
        graph: params.graph,
        stopReasons: params.stopReasons,
        failedTasks: params.failedTasks
      })
    }
  }

  if (params.format === "jsonl") {
    return {
      nodes: params.graph.nodes,
      edges: params.graph.edges,
      events: params.graph.events,
      serialized: formatTraceAsJsonl(params.graph)
    }
  }

  return {
    nodes: params.graph.nodes,
    edges: params.graph.edges,
    events: params.graph.events,
    serialized: formatTraceAsJson(params.graph)
  }
}

export function exportHarnessTrace(params: {
  runId: string
  taskKey?: string
  format?: HarnessTraceExportFormat
}): HarnessTraceExport {
  const run = getHarnessRun(params.runId)
  if (!run) {
    throw new Error(`Harness run "${params.runId}" not found.`)
  }

  const taskResults = listHarnessTaskResults(params.runId).filter((taskResult) =>
    params.taskKey ? taskResult.taskKey === params.taskKey : true
  )
  const taskThreadIds = new Set(
    taskResults
      .map((taskResult) => taskResult.threadId)
      .filter((threadId): threadId is string => typeof threadId === "string" && threadId.length > 0)
  )
  const artifacts = listHarnessArtifacts(params.runId, params.taskKey)
  const timelineEvents = listTimelineEventsByWorkspace(run.workspaceId, 1000).filter((event) => {
    const payload = asRecord(event.payload)
    return (
      payload.harnessRunId === params.runId ||
      payload.runId === params.runId ||
      taskThreadIds.has(event.threadId)
    )
  })

  const graph = buildTraceGraph({
    runId: params.runId,
    taskKey: params.taskKey,
    runData: run as unknown as Record<string, unknown>,
    taskResults: taskResults as unknown as Array<Record<string, unknown>>,
    artifacts: artifacts as unknown as Array<Record<string, unknown>>,
    timelineEvents: timelineEvents as unknown as Array<Record<string, unknown>>
  })

  const redacted = redactHarnessPayload(graph)
  const format = params.format || "json"
  const materialized = materializeTraceByFormat({
    runId: params.runId,
    taskKey: params.taskKey,
    format,
    graph: redacted,
    stopReasons: run.summary.stopReasons,
    failedTasks: taskResults
      .filter((task) => task.status === "failed" || task.scoreTotal < 70)
      .slice(0, 20)
      .map((task) => ({
        key: task.taskKey,
        score: task.scoreTotal,
        stopReason: task.stopReason
      }))
  })
  const summary = {
    nodeCount: materialized.nodes.length,
    edgeCount: materialized.edges.length,
    generatedAt: new Date().toISOString(),
    redactionVersion: "1"
  }

  return createHarnessTraceExport({
    runId: params.runId,
    taskKey: params.taskKey,
    format,
    serialized: materialized.serialized,
    trace: {
      nodes: materialized.nodes,
      edges: materialized.edges,
      events: materialized.events
    },
    summary,
    redactionVersion: "1",
    retentionTtlDays: 30
  })
}

export function getLatestHarnessTraceForRun(runId: string): HarnessTraceExport | null {
  const traces = listHarnessTraceExports(runId)
  return traces[0] || null
}
