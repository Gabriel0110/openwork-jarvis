import { v4 as uuid } from "uuid"
import { getDb, scheduleDatabaseSave } from "./index"
import type {
  HarnessFinding,
  HarnessFindingSeverity,
  HarnessFindingStatus,
  HarnessHypothesis
} from "../types"

interface HarnessFindingRow {
  finding_id: string
  run_id: string
  task_key: string | null
  fingerprint: string
  category: HarnessFinding["category"]
  severity: HarnessFindingSeverity
  status: HarnessFindingStatus
  title: string
  summary: string
  evidence_json: string
  confidence: number
  intervention_json: string
  reviewer_notes: string | null
  reviewed_by: string | null
  reviewed_at: number | null
  created_at: number
  updated_at: number
}

interface HarnessHypothesisRow {
  hypothesis_id: string
  finding_id: string
  run_id: string
  title: string
  summary: string
  intervention_type: string
  intervention_payload_json: string
  confidence: number
  rank: number
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

function parseEvidence(value: string): Array<{ nodeId?: string; description: string }> {
  try {
    const parsed = JSON.parse(value)
    if (!Array.isArray(parsed)) {
      return []
    }
    const results: Array<{ nodeId?: string; description: string }> = []
    for (const item of parsed) {
      if (!item || typeof item !== "object") {
        continue
      }
      const typed = item as Record<string, unknown>
      const description = typeof typed.description === "string" ? typed.description.trim() : ""
      if (!description) {
        continue
      }
      results.push({
        nodeId: typeof typed.nodeId === "string" ? typed.nodeId : undefined,
        description
      })
    }
    return results
  } catch {
    return []
  }
}

function mapHypothesisRow(row: HarnessHypothesisRow): HarnessHypothesis {
  return {
    id: row.hypothesis_id,
    findingId: row.finding_id,
    runId: row.run_id,
    title: row.title,
    summary: row.summary,
    interventionType: row.intervention_type,
    interventionPayload: parseJsonObject(row.intervention_payload_json),
    confidence: Number(row.confidence || 0),
    rank: Number(row.rank || 1),
    createdAt: new Date(row.created_at)
  }
}

function mapFindingRow(row: HarnessFindingRow, hypotheses?: HarnessHypothesis[]): HarnessFinding {
  return {
    id: row.finding_id,
    runId: row.run_id,
    taskKey: row.task_key || undefined,
    fingerprint: row.fingerprint,
    category: row.category,
    severity: row.severity,
    status: row.status,
    title: row.title,
    summary: row.summary,
    evidence: parseEvidence(row.evidence_json),
    confidence: Number(row.confidence || 0),
    intervention: parseJsonObject(row.intervention_json),
    reviewerNotes: row.reviewer_notes || undefined,
    reviewedBy: row.reviewed_by || undefined,
    reviewedAt: row.reviewed_at ? new Date(row.reviewed_at) : undefined,
    createdAt: new Date(row.created_at),
    updatedAt: new Date(row.updated_at),
    hypotheses
  }
}

export interface CreateHarnessFindingInput {
  runId: string
  taskKey?: string
  fingerprint: string
  category: HarnessFinding["category"]
  severity: HarnessFindingSeverity
  title: string
  summary: string
  evidence?: Array<{ nodeId?: string; description: string }>
  confidence: number
  intervention?: Record<string, unknown>
  status?: HarnessFindingStatus
}

export interface CreateHarnessHypothesisInput {
  findingId: string
  runId: string
  title: string
  summary: string
  interventionType: string
  interventionPayload?: Record<string, unknown>
  confidence: number
  rank: number
}

export interface ListHarnessFindingsFilters {
  runId?: string
  status?: HarnessFindingStatus
  severity?: HarnessFindingSeverity
  limit?: number
}

export function createHarnessFinding(input: CreateHarnessFindingInput): HarnessFinding {
  const database = getDb()
  const findingId = uuid()
  const now = Date.now()

  database.run(
    `INSERT INTO harness_findings (
      finding_id, run_id, task_key, fingerprint, category, severity, status, title, summary,
      evidence_json, confidence, intervention_json, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      findingId,
      input.runId,
      input.taskKey || null,
      input.fingerprint,
      input.category,
      input.severity,
      input.status || "pending_review",
      input.title,
      input.summary,
      JSON.stringify(input.evidence || []),
      input.confidence,
      JSON.stringify(input.intervention || {}),
      now,
      now
    ]
  )

  scheduleDatabaseSave()
  const finding = getHarnessFinding(findingId)
  if (!finding) {
    throw new Error("Failed to create harness finding.")
  }
  return finding
}

export function getHarnessFinding(findingId: string): HarnessFinding | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM harness_findings WHERE finding_id = ? LIMIT 1")
  stmt.bind([findingId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as unknown as HarnessFindingRow
  stmt.free()
  const hypotheses = listHarnessHypothesesByFinding(findingId)
  return mapFindingRow(row, hypotheses)
}

export function listHarnessFindings(filters?: ListHarnessFindingsFilters): HarnessFinding[] {
  const database = getDb()
  const conditions: string[] = []
  const values: Array<string | number> = []

  if (filters?.runId) {
    conditions.push("run_id = ?")
    values.push(filters.runId)
  }
  if (filters?.status) {
    conditions.push("status = ?")
    values.push(filters.status)
  }
  if (filters?.severity) {
    conditions.push("severity = ?")
    values.push(filters.severity)
  }

  const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : ""
  const limit = Math.max(1, Math.min(filters?.limit || 200, 1000))
  const stmt = database.prepare(
    `SELECT * FROM harness_findings ${whereSql} ORDER BY created_at DESC LIMIT ?`
  )
  stmt.bind([...values, limit])

  const rows: HarnessFinding[] = []
  while (stmt.step()) {
    const row = stmt.getAsObject() as unknown as HarnessFindingRow
    rows.push(mapFindingRow(row))
  }
  stmt.free()

  for (const finding of rows) {
    finding.hypotheses = listHarnessHypothesesByFinding(finding.id)
  }

  return rows
}

export function reviewHarnessFinding(
  findingId: string,
  status: Extract<HarnessFindingStatus, "approved" | "rejected" | "queued_for_experiment">,
  notes?: string,
  reviewer?: string
): HarnessFinding | null {
  const database = getDb()
  const now = Date.now()

  database.run(
    `UPDATE harness_findings
     SET status = ?, reviewer_notes = ?, reviewed_by = ?, reviewed_at = ?, updated_at = ?
     WHERE finding_id = ?`,
    [status, notes || null, reviewer || null, now, now, findingId]
  )

  scheduleDatabaseSave()
  return getHarnessFinding(findingId)
}

export function createHarnessHypothesis(input: CreateHarnessHypothesisInput): HarnessHypothesis {
  const database = getDb()
  const hypothesisId = uuid()
  const now = Date.now()

  database.run(
    `INSERT INTO harness_hypotheses (
      hypothesis_id, finding_id, run_id, title, summary, intervention_type,
      intervention_payload_json, confidence, rank, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      hypothesisId,
      input.findingId,
      input.runId,
      input.title,
      input.summary,
      input.interventionType,
      JSON.stringify(input.interventionPayload || {}),
      input.confidence,
      input.rank,
      now
    ]
  )

  scheduleDatabaseSave()
  const hypothesis = getHarnessHypothesis(hypothesisId)
  if (!hypothesis) {
    throw new Error("Failed to create harness hypothesis.")
  }
  return hypothesis
}

export function getHarnessHypothesis(hypothesisId: string): HarnessHypothesis | null {
  const database = getDb()
  const stmt = database.prepare("SELECT * FROM harness_hypotheses WHERE hypothesis_id = ? LIMIT 1")
  stmt.bind([hypothesisId])
  if (!stmt.step()) {
    stmt.free()
    return null
  }
  const row = stmt.getAsObject() as unknown as HarnessHypothesisRow
  stmt.free()
  return mapHypothesisRow(row)
}

export function listHarnessHypothesesByFinding(findingId: string): HarnessHypothesis[] {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT * FROM harness_hypotheses WHERE finding_id = ? ORDER BY rank ASC, created_at ASC"
  )
  stmt.bind([findingId])
  const rows: HarnessHypothesis[] = []
  while (stmt.step()) {
    rows.push(mapHypothesisRow(stmt.getAsObject() as unknown as HarnessHypothesisRow))
  }
  stmt.free()
  return rows
}

export function deleteExpiredHarnessFindings(nowMs: number = Date.now()): number {
  const database = getDb()
  const stmt = database.prepare(
    "SELECT finding_id, created_at, retention_ttl_days FROM harness_findings"
  )
  const expiredIds: string[] = []

  while (stmt.step()) {
    const row = stmt.getAsObject() as {
      finding_id: string
      created_at: number
      retention_ttl_days: number
    }
    const ageMs = nowMs - Number(row.created_at || nowMs)
    const ttlMs = Math.max(1, Number(row.retention_ttl_days || 180)) * 24 * 60 * 60 * 1000
    if (ageMs > ttlMs) {
      expiredIds.push(row.finding_id)
    }
  }
  stmt.free()

  if (expiredIds.length === 0) {
    return 0
  }

  for (const findingId of expiredIds) {
    database.run("DELETE FROM harness_findings WHERE finding_id = ?", [findingId])
  }
  scheduleDatabaseSave()
  return expiredIds.length
}
