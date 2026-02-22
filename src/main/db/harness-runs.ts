import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import { DEFAULT_WORKSPACE_ID } from "./workspaces"
import type {
  HarnessArtifactRecord,
  HarnessRun,
  HarnessRunStatus,
  HarnessScoreBreakdown,
  HarnessStopReason,
  HarnessTaskResult,
  HarnessTaskStatus,
  HarnessTaskTier
} from "../types"

interface HarnessRunRow {
  run_id: string
  workspace_id: string
  suite_key: string
  suite_name: string
  profile_key: string
  status: HarnessRunStatus
  model_profile: string | null
  execution_mode: "local" | "matrix" | "live" | "synthetic"
  seed: number | null
  started_at: number | null
  completed_at: number | null
  duration_ms: number | null
  summary_json: string
  error_text: string | null
  created_at: number
  updated_at: number
}

interface HarnessTaskResultRow {
  task_result_id: string
  run_id: string
  task_key: string
  task_name: string
  task_tier: HarnessTaskTier
  status: HarnessTaskStatus
  thread_id: string | null
  score_total: number
  score_breakdown_json: string
  duration_ms: number
  token_usage: number
  tool_calls: number
  cost_usd: number
  stop_reason: HarnessStopReason | null
  notes: string | null
  created_at: number
  updated_at: number
}

interface HarnessArtifactRow {
  artifact_id: string
  run_id: string
  task_key: string
  artifact_type: string
  artifact_path: string | null
  artifact_hash: string | null
  payload_json: string
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

function parseScoreBreakdown(value: string): HarnessScoreBreakdown {
  const parsed = parseJsonObject(value)
  const fallback: HarnessScoreBreakdown = {
    correctness: 0,
    completeness: 0,
    safetyCompliance: 0,
    efficiency: 0,
    toolHygiene: 0,
    weightedTotal: 0
  }

  return {
    correctness:
      typeof parsed.correctness === "number" ? Number(parsed.correctness) : fallback.correctness,
    completeness:
      typeof parsed.completeness === "number" ? Number(parsed.completeness) : fallback.completeness,
    safetyCompliance:
      typeof parsed.safetyCompliance === "number"
        ? Number(parsed.safetyCompliance)
        : fallback.safetyCompliance,
    efficiency:
      typeof parsed.efficiency === "number" ? Number(parsed.efficiency) : fallback.efficiency,
    toolHygiene:
      typeof parsed.toolHygiene === "number" ? Number(parsed.toolHygiene) : fallback.toolHygiene,
    weightedTotal:
      typeof parsed.weightedTotal === "number"
        ? Number(parsed.weightedTotal)
        : fallback.weightedTotal
  }
}

function mapHarnessRunRow(row: HarnessRunRow): HarnessRun {
  const parsedSummary = parseJsonObject(row.summary_json)
  const scoreByTierRaw =
    typeof parsedSummary.scoreByTier === "object" && parsedSummary.scoreByTier
      ? (parsedSummary.scoreByTier as Record<string, unknown>)
      : {}
  const stopReasonsRaw =
    typeof parsedSummary.stopReasons === "object" && parsedSummary.stopReasons
      ? (parsedSummary.stopReasons as Record<string, unknown>)
      : {}

  return {
    id: row.run_id,
    workspaceId: row.workspace_id,
    suiteKey: row.suite_key,
    suiteName: row.suite_name,
    profileKey: row.profile_key,
    status: row.status,
    modelProfile: row.model_profile || undefined,
    executionMode: row.execution_mode,
    seed: row.seed ?? undefined,
    startedAt: row.started_at ? new Date(row.started_at) : undefined,
    completedAt: row.completed_at ? new Date(row.completed_at) : undefined,
    durationMs: row.duration_ms ?? undefined,
    summary: {
      taskCount: Number(parsedSummary.taskCount || 0),
      passedCount: Number(parsedSummary.passedCount || 0),
      failedCount: Number(parsedSummary.failedCount || 0),
      averageScore: Number(parsedSummary.averageScore || 0),
      scoreByTier: {
        easy: Number(scoreByTierRaw.easy || 0),
        medium: Number(scoreByTierRaw.medium || 0),
        hard: Number(scoreByTierRaw.hard || 0)
      },
      stopReasons: Object.fromEntries(
        Object.entries(stopReasonsRaw).map(([key, value]) => [key, Number(value || 0)])
      )
    },
    errorText: row.error_text || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

function mapTaskResultRow(row: HarnessTaskResultRow): HarnessTaskResult {
  return {
    id: row.task_result_id,
    runId: row.run_id,
    taskKey: row.task_key,
    taskName: row.task_name,
    taskTier: row.task_tier,
    status: row.status,
    threadId: row.thread_id || undefined,
    scoreTotal: Number(row.score_total || 0),
    scoreBreakdown: parseScoreBreakdown(row.score_breakdown_json),
    durationMs: Number(row.duration_ms || 0),
    tokenUsage: Number(row.token_usage || 0),
    toolCalls: Number(row.tool_calls || 0),
    costUsd: Number(row.cost_usd || 0),
    stopReason: row.stop_reason || undefined,
    notes: row.notes || undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at)
  }
}

function mapArtifactRow(row: HarnessArtifactRow): HarnessArtifactRecord {
  return {
    id: row.artifact_id,
    runId: row.run_id,
    taskKey: row.task_key,
    artifactType: row.artifact_type,
    artifactPath: row.artifact_path || undefined,
    artifactHash: row.artifact_hash || undefined,
    payload: parseJsonObject(row.payload_json),
    retentionTtlDays: Number(row.retention_ttl_days || 30),
    createdAt: new Date(row.created_at)
  }
}

export interface CreateHarnessRunInput {
  workspaceId?: string
  suiteKey: string
  suiteName: string
  profileKey: string
  modelProfile?: string
  executionMode: "local" | "matrix" | "live" | "synthetic"
  seed?: number
  status?: HarnessRunStatus
  summary?: HarnessRun["summary"]
}

export interface UpdateHarnessRunInput {
  status?: HarnessRunStatus
  startedAt?: number | null
  completedAt?: number | null
  durationMs?: number | null
  summary?: HarnessRun["summary"]
  errorText?: string | null
}

export interface CreateHarnessTaskResultInput {
  runId: string
  taskKey: string
  taskName: string
  taskTier: HarnessTaskTier
  status: HarnessTaskStatus
  threadId?: string
  scoreTotal: number
  scoreBreakdown: HarnessScoreBreakdown
  durationMs: number
  tokenUsage?: number
  toolCalls?: number
  costUsd?: number
  stopReason?: HarnessStopReason
  notes?: string
}

export interface CreateHarnessArtifactInput {
  runId: string
  taskKey: string
  artifactType: string
  artifactPath?: string
  artifactHash?: string
  payload?: Record<string, unknown>
  retentionTtlDays?: number
}

export interface ListHarnessRunsFilters {
  status?: HarnessRunStatus
  suiteKey?: string
  workspaceId?: string
  limit?: number
}

export function createHarnessRun(input: CreateHarnessRunInput): HarnessRun {
  const database = getDb()
  const now = Date.now()
  const runId = uuid()

  database.run(
    `INSERT INTO harness_runs (
      run_id, workspace_id, suite_key, suite_name, profile_key, status, model_profile,
      execution_mode, seed, summary_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      runId,
      input.workspaceId || DEFAULT_WORKSPACE_ID,
      input.suiteKey,
      input.suiteName,
      input.profileKey,
      input.status || "queued",
      input.modelProfile || null,
      input.executionMode,
      input.seed ?? null,
      JSON.stringify(
        input.summary || {
          taskCount: 0,
          passedCount: 0,
          failedCount: 0,
          averageScore: 0,
          scoreByTier: { easy: 0, medium: 0, hard: 0 },
          stopReasons: {}
        }
      ),
      now,
      now
    ]
  )

  scheduleDatabaseSave()
  return getHarnessRun(runId) as HarnessRun
}

export function updateHarnessRun(runId: string, updates: UpdateHarnessRunInput): HarnessRun | null {
  const database = getDb()
  const existing = getHarnessRun(runId)
  if (!existing) {
    return null
  }

  const now = Date.now()
  const setClauses: string[] = ["updated_at = ?"]
  const values: Array<string | number | null> = [now]

  if (updates.status !== undefined) {
    setClauses.push("status = ?")
    values.push(updates.status)
  }
  if (updates.startedAt !== undefined) {
    setClauses.push("started_at = ?")
    values.push(updates.startedAt)
  }
  if (updates.completedAt !== undefined) {
    setClauses.push("completed_at = ?")
    values.push(updates.completedAt)
  }
  if (updates.durationMs !== undefined) {
    setClauses.push("duration_ms = ?")
    values.push(updates.durationMs)
  }
  if (updates.summary !== undefined) {
    setClauses.push("summary_json = ?")
    values.push(JSON.stringify(updates.summary))
  }
  if (updates.errorText !== undefined) {
    setClauses.push("error_text = ?")
    values.push(updates.errorText)
  }

  values.push(runId)
  database.run(`UPDATE harness_runs SET ${setClauses.join(", ")} WHERE run_id = ?`, values)
  scheduleDatabaseSave()
  return getHarnessRun(runId)
}

export function getHarnessRun(runId: string): HarnessRun | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM harness_runs WHERE run_id = ? LIMIT 1")
  stmt.bind([runId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as unknown as HarnessRunRow
  stmt.free()
  return mapHarnessRunRow(row)
}

export function listHarnessRuns(filters?: ListHarnessRunsFilters): HarnessRun[] {
  const database = getDb()
  const conditions: string[] = []
  const values: Array<string | number> = []

  if (filters?.status) {
    conditions.push("status = ?")
    values.push(filters.status)
  }
  if (filters?.suiteKey) {
    conditions.push("suite_key = ?")
    values.push(filters.suiteKey)
  }
  if (filters?.workspaceId) {
    conditions.push("workspace_id = ?")
    values.push(filters.workspaceId)
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = Math.max(1, Math.min(filters?.limit || 100, 500))
  const stmt = database.prepare(
    `SELECT * FROM harness_runs ${whereSql} ORDER BY created_at DESC LIMIT ?`
  )
  stmt.bind([...values, limit])

  const rows: HarnessRun[] = []
  while (stmt.step()) {
    rows.push(mapHarnessRunRow(stmt.getAsObject() as unknown as HarnessRunRow))
  }
  stmt.free()
  return rows
}

export function createHarnessTaskResult(input: CreateHarnessTaskResultInput): HarnessTaskResult {
  const database = getDb()
  const now = Date.now()
  const taskResultId = uuid()

  database.run(
    `INSERT INTO harness_task_results (
      task_result_id, run_id, task_key, task_name, task_tier, status, thread_id, score_total,
      score_breakdown_json, duration_ms, token_usage, tool_calls, cost_usd, stop_reason, notes,
      created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      taskResultId,
      input.runId,
      input.taskKey,
      input.taskName,
      input.taskTier,
      input.status,
      input.threadId || null,
      input.scoreTotal,
      JSON.stringify(input.scoreBreakdown),
      input.durationMs,
      input.tokenUsage || 0,
      input.toolCalls || 0,
      input.costUsd || 0,
      input.stopReason || null,
      input.notes || null,
      now,
      now
    ]
  )

  scheduleDatabaseSave()
  const taskResult = getHarnessTaskResult(taskResultId)
  if (!taskResult) {
    throw new Error("Failed to create harness task result.")
  }
  return taskResult
}

export function getHarnessTaskResult(taskResultId: string): HarnessTaskResult | null {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM harness_task_results WHERE task_result_id = ? LIMIT 1"
  )
  stmt.bind([taskResultId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as unknown as HarnessTaskResultRow
  stmt.free()
  return mapTaskResultRow(row)
}

export function listHarnessTaskResults(runId: string): HarnessTaskResult[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM harness_task_results WHERE run_id = ? ORDER BY created_at ASC"
  )
  stmt.bind([runId])
  const rows: HarnessTaskResult[] = []
  while (stmt.step()) {
    rows.push(mapTaskResultRow(stmt.getAsObject() as unknown as HarnessTaskResultRow))
  }
  stmt.free()
  return rows
}

export function createHarnessArtifact(input: CreateHarnessArtifactInput): HarnessArtifactRecord {
  const database = getDb()
  const artifactId = uuid()
  const now = Date.now()

  database.run(
    `INSERT INTO harness_artifacts (
      artifact_id, run_id, task_key, artifact_type, artifact_path, artifact_hash, payload_json,
      retention_ttl_days, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      artifactId,
      input.runId,
      input.taskKey,
      input.artifactType,
      input.artifactPath || null,
      input.artifactHash || null,
      JSON.stringify(input.payload || {}),
      input.retentionTtlDays || 30,
      now
    ]
  )

  scheduleDatabaseSave()
  const artifact = getHarnessArtifact(artifactId)
  if (!artifact) {
    throw new Error("Failed to create harness artifact.")
  }
  return artifact
}

export function getHarnessArtifact(artifactId: string): HarnessArtifactRecord | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM harness_artifacts WHERE artifact_id = ? LIMIT 1")
  stmt.bind([artifactId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as unknown as HarnessArtifactRow
  stmt.free()
  return mapArtifactRow(row)
}

export function listHarnessArtifacts(runId: string, taskKey?: string): HarnessArtifactRecord[] {
  const database = getDb()
  const hasTaskKey = typeof taskKey === "string" && taskKey.trim().length > 0
  const stmt = database.prepare(
    `SELECT * FROM harness_artifacts
     WHERE run_id = ? ${hasTaskKey ? "AND task_key = ?" : ""}
     ORDER BY created_at ASC`
  )
  stmt.bind(hasTaskKey ? [runId, taskKey] : [runId])

  const rows: HarnessArtifactRecord[] = []
  while (stmt.step()) {
    rows.push(mapArtifactRow(stmt.getAsObject() as unknown as HarnessArtifactRow))
  }
  stmt.free()
  return rows
}
