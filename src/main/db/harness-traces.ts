import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import type {
  HarnessTraceEdge,
  HarnessTraceExport,
  HarnessTraceExportFormat,
  HarnessTraceNode
} from "../types"

interface HarnessTraceExportRow {
  trace_export_id: string
  run_id: string
  task_key: string | null
  format: HarnessTraceExportFormat
  trace_json: string
  summary_json: string
  redaction_version: string
  retention_ttl_days: number
  created_at: number
}

function parseJsonObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) {
    return {}
  }
  try {
    const parsed = JSON.parse(value)
    if (typeof parsed === "object" && parsed && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // no-op
  }
  return {}
}

function parseJsonArray(value: string | null | undefined): Array<Record<string, unknown>> {
  if (!value) {
    return []
  }
  try {
    const parsed = JSON.parse(value)
    if (Array.isArray(parsed)) {
      return parsed.filter(
        (item): item is Record<string, unknown> => typeof item === "object" && item !== null
      )
    }
  } catch {
    // no-op
  }
  return []
}

function parseTraceNodes(value: unknown): HarnessTraceNode[] {
  if (!Array.isArray(value)) {
    return []
  }
  const nodes: HarnessTraceNode[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue
    }
    const typed = item as Record<string, unknown>
    if (
      typeof typed.id !== "string" ||
      typeof typed.type !== "string" ||
      typeof typed.label !== "string" ||
      typeof typed.timestamp !== "string"
    ) {
      continue
    }
    const data =
      typeof typed.data === "object" && typed.data && !Array.isArray(typed.data)
        ? (typed.data as Record<string, unknown>)
        : {}
    nodes.push({
      id: typed.id,
      type: typed.type as HarnessTraceNode["type"],
      label: typed.label,
      timestamp: typed.timestamp,
      data
    })
  }
  return nodes
}

function parseTraceEdges(value: unknown): HarnessTraceEdge[] {
  if (!Array.isArray(value)) {
    return []
  }
  const edges: HarnessTraceEdge[] = []
  for (const item of value) {
    if (!item || typeof item !== "object") {
      continue
    }
    const typed = item as Record<string, unknown>
    if (
      typeof typed.id !== "string" ||
      typeof typed.from !== "string" ||
      typeof typed.to !== "string" ||
      typeof typed.type !== "string"
    ) {
      continue
    }
    edges.push({
      id: typed.id,
      from: typed.from,
      to: typed.to,
      type: typed.type as HarnessTraceEdge["type"]
    })
  }
  return edges
}

function mapTraceExportRow(row: HarnessTraceExportRow): HarnessTraceExport {
  const trace = parseJsonObject(row.trace_json)
  const summary = parseJsonObject(row.summary_json)
  const serialized = typeof trace.serialized === "string" ? trace.serialized : undefined

  return {
    id: row.trace_export_id,
    runId: row.run_id,
    taskKey: row.task_key || undefined,
    format: row.format,
    serialized,
    summary: {
      nodeCount: Number(summary.nodeCount || 0),
      edgeCount: Number(summary.edgeCount || 0),
      generatedAt:
        typeof summary.generatedAt === "string"
          ? summary.generatedAt
          : new Date(row.created_at).toISOString(),
      redactionVersion:
        typeof summary.redactionVersion === "string"
          ? summary.redactionVersion
          : row.redaction_version
    },
    nodes: parseTraceNodes(trace.nodes),
    edges: parseTraceEdges(trace.edges),
    events: parseJsonArray(JSON.stringify(trace.events || [])),
    createdAt: new Date(row.created_at)
  }
}

export interface CreateHarnessTraceExportInput {
  runId: string
  taskKey?: string
  format: HarnessTraceExportFormat
  serialized?: string
  trace: {
    nodes: HarnessTraceExport["nodes"]
    edges: HarnessTraceExport["edges"]
    events: HarnessTraceExport["events"]
  }
  summary: HarnessTraceExport["summary"]
  redactionVersion?: string
  retentionTtlDays?: number
}

export function createHarnessTraceExport(input: CreateHarnessTraceExportInput): HarnessTraceExport {
  const database = getDb()
  const traceExportId = uuid()
  const now = Date.now()

  database.run(
    `INSERT INTO harness_trace_exports (
      trace_export_id, run_id, task_key, format, trace_json, summary_json, redaction_version,
      retention_ttl_days, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      traceExportId,
      input.runId,
      input.taskKey || null,
      input.format,
      JSON.stringify({
        nodes: input.trace.nodes,
        edges: input.trace.edges,
        events: input.trace.events,
        serialized: input.serialized || null
      }),
      JSON.stringify(input.summary),
      input.redactionVersion || "1",
      input.retentionTtlDays || 30,
      now
    ]
  )

  scheduleDatabaseSave()
  const traceExport = getHarnessTraceExport(traceExportId)
  if (!traceExport) {
    throw new Error("Failed to create harness trace export.")
  }
  return traceExport
}

export function getHarnessTraceExport(traceExportId: string): HarnessTraceExport | null {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM harness_trace_exports WHERE trace_export_id = ? LIMIT 1"
  )
  stmt.bind([traceExportId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as unknown as HarnessTraceExportRow
  stmt.free()
  return mapTraceExportRow(row)
}

export function listHarnessTraceExports(runId: string): HarnessTraceExport[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM harness_trace_exports WHERE run_id = ? ORDER BY created_at DESC"
  )
  stmt.bind([runId])

  const rows: HarnessTraceExport[] = []
  while (stmt.step()) {
    rows.push(mapTraceExportRow(stmt.getAsObject() as unknown as HarnessTraceExportRow))
  }
  stmt.free()
  return rows
}

export function deleteExpiredHarnessTraceExports(nowMs: number = Date.now()): number {
  const database = getDb()
  const stmt = database.prepare(
    `SELECT trace_export_id, created_at, retention_ttl_days FROM harness_trace_exports`
  )
  const expiredIds: string[] = []

  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      trace_export_id: string
      created_at: number
      retention_ttl_days: number
    }
    const ageMs = nowMs - Number(row.created_at || nowMs)
    const ttlMs = Math.max(1, Number(row.retention_ttl_days || 30)) * 24 * 60 * 60 * 1000
    if (ageMs > ttlMs) {
      expiredIds.push(row.trace_export_id)
    }
  }
  stmt.free()

  if (expiredIds.length === 0) {
    return 0
  }

  for (const traceExportId of expiredIds) {
    database.run("DELETE FROM harness_trace_exports WHERE trace_export_id = ?", [traceExportId])
  }
  scheduleDatabaseSave()
  return expiredIds.length
}
