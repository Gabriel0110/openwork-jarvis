import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import type { WorkflowTemplateScheduleRun, WorkflowTemplateScheduleRunStatus } from "../types"

export type TemplateScheduleRunStatus = WorkflowTemplateScheduleRunStatus
export type TemplateScheduleRun = WorkflowTemplateScheduleRun

interface TemplateScheduleRunRow {
  schedule_run_id: string
  template_id: string
  workspace_id: string
  scheduled_for: number
  status: string
  run_thread_id: string | null
  missing_connectors: string
  error_message: string | null
  metadata: string
  created_at: number
  updated_at: number
}

interface CreateTemplateScheduleRunAttemptParams {
  templateId: string
  workspaceId: string
  scheduledFor: number
  metadata?: Record<string, unknown>
}

interface UpdateTemplateScheduleRunParams {
  status: TemplateScheduleRunStatus
  runThreadId?: string
  missingConnectors?: string[]
  errorMessage?: string
  metadata?: Record<string, unknown>
}

function parseStringArray(raw: string): string[] {
  try {
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed.filter((item) => typeof item === "string") : []
  } catch {
    return []
  }
}

function parseObject(raw: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(raw)
    return typeof parsed === "object" && parsed ? (parsed as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

function mapRow(row: TemplateScheduleRunRow): TemplateScheduleRun {
  const normalizedStatus: TemplateScheduleRunStatus =
    row.status === "started" || row.status === "blocked" || row.status === "error"
      ? row.status
      : "pending"

  return {
    id: row.schedule_run_id,
    templateId: row.template_id,
    workspaceId: row.workspace_id,
    scheduledFor: new Date(row.scheduled_for),
    status: normalizedStatus,
    runThreadId: row.run_thread_id || undefined,
    missingConnectors: parseStringArray(row.missing_connectors),
    errorMessage: row.error_message || undefined,
    metadata: parseObject(row.metadata),
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

function getTemplateScheduleRunRow(
  templateId: string,
  scheduledFor: number
): TemplateScheduleRunRow | null {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM template_schedule_runs WHERE template_id = ? AND scheduled_for = ? LIMIT 1"
  )
  stmt.bind([templateId, scheduledFor])

  if (!stmt.step()) {
    stmt.free()
    return null
  }

  const row = stmt.getAsObject() as unknown as TemplateScheduleRunRow
  stmt.free()
  return row
}

export function createTemplateScheduleRunAttempt(params: CreateTemplateScheduleRunAttemptParams): {
  run: TemplateScheduleRun
  inserted: boolean
} {
  const existing = getTemplateScheduleRunRow(params.templateId, params.scheduledFor)
  if (existing) {
    return { run: mapRow(existing), inserted: false }
  }

  const database = getDb()
  const now = Date.now()
  const runId = uuid()

  database.run(
    `INSERT INTO template_schedule_runs (
      schedule_run_id, template_id, workspace_id, scheduled_for, status, run_thread_id,
      missing_connectors, error_message, metadata, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      params.templateId,
      params.workspaceId,
      params.scheduledFor,
      "pending",
      null,
      "[]",
      null,
      JSON.stringify(params.metadata || {}),
      now,
      now
    ]
  )

  scheduleDatabaseSave()

  const inserted = getTemplateScheduleRunRow(params.templateId, params.scheduledFor)
  if (!inserted) {
    throw new Error("Failed to create template schedule run attempt.")
  }
  return { run: mapRow(inserted), inserted: true }
}

export function updateTemplateScheduleRun(
  scheduleRunId: string,
  params: UpdateTemplateScheduleRunParams
): TemplateScheduleRun | null {
  const database = getDb()
  const existingStmt = database.prepare(
    "SELECT * FROM template_schedule_runs WHERE schedule_run_id = ? LIMIT 1"
  )
  existingStmt.bind([scheduleRunId])
  if (!existingStmt.step()) {
    existingStmt.free()
    return null
  }
  const existing = mapRow(existingStmt.getAsObject() as unknown as TemplateScheduleRunRow)
  existingStmt.free()

  const nextMetadata = params.metadata
    ? { ...existing.metadata, ...params.metadata }
    : existing.metadata
  const nextMissingConnectors = params.missingConnectors || existing.missingConnectors
  const now = Date.now()

  database.run(
    `UPDATE template_schedule_runs
     SET status = ?, run_thread_id = ?, missing_connectors = ?, error_message = ?, metadata = ?, updated_at = ?
     WHERE schedule_run_id = ?`,
    [
      params.status,
      params.runThreadId ?? existing.runThreadId ?? null,
      JSON.stringify(nextMissingConnectors),
      params.errorMessage ?? existing.errorMessage ?? null,
      JSON.stringify(nextMetadata),
      now,
      scheduleRunId
    ]
  )

  scheduleDatabaseSave()

  const nextStmt = database.prepare(
    "SELECT * FROM template_schedule_runs WHERE schedule_run_id = ? LIMIT 1"
  )
  nextStmt.bind([scheduleRunId])
  if (!nextStmt.step()) {
    nextStmt.free()
    return null
  }

  const next = mapRow(nextStmt.getAsObject() as unknown as TemplateScheduleRunRow)
  nextStmt.free()
  return next
}

export function listTemplateScheduleRuns(
  workspaceId: string,
  options?: { templateId?: string; limit?: number }
): TemplateScheduleRun[] {
  const database = getDb()
  const requestedLimit = Number(options?.limit || 0)
  const limit = Number.isFinite(requestedLimit) && requestedLimit > 0 ? requestedLimit : 100
  const templateId = options?.templateId?.trim()

  const sql = templateId
    ? "SELECT * FROM template_schedule_runs WHERE workspace_id = ? AND template_id = ? ORDER BY scheduled_for DESC LIMIT ?"
    : "SELECT * FROM template_schedule_runs WHERE workspace_id = ? ORDER BY scheduled_for DESC LIMIT ?"

  const values = templateId ? [workspaceId, templateId, limit] : [workspaceId, limit]
  const stmt = database.prepare(sql)
  stmt.bind(values)

  const rows: TemplateScheduleRun[] = []
  while (stmt.step()) {
    rows.push(mapRow(stmt.getAsObject() as unknown as TemplateScheduleRunRow))
  }
  stmt.free()
  return rows
}
