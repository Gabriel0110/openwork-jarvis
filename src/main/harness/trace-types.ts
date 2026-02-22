import type { HarnessTraceEdge, HarnessTraceNode } from "../types"

export interface HarnessTraceGraph {
  nodes: HarnessTraceNode[]
  edges: HarnessTraceEdge[]
  events: Array<Record<string, unknown>>
}

export interface HarnessTraceBuildInput {
  runId: string
  taskKey?: string
  runData: Record<string, unknown>
  taskResults: Array<Record<string, unknown>>
  artifacts: Array<Record<string, unknown>>
  timelineEvents?: Array<Record<string, unknown>>
}

export function buildHarnessFingerprint(parts: Array<string | undefined | null>): string {
  return parts
    .map((part) => (part || "").trim().toLowerCase())
    .filter((part) => part.length > 0)
    .join("|")
}
